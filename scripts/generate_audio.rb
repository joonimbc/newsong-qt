#!/usr/bin/env ruby
# frozen_string_literal: true

# 일일/주간 큐티 성경 본문 & 스토리 AI 낭독 오디오(.m4a) 자동 생성 스크립트
#  - 모델: gemini-3.8-flash-tts
#  - 음성: 남성(Charon, 차분하고 깊이 있는 톤) · 여성(Sulafat, 따뜻하고 또렷한 톤)
#  - 출력:
#      본문: data/audio/YYYY-MM-DD-male.m4a, YYYY-MM-DD-female.m4a
#      스토리: data/audio/YYYY-MM-DD-story-male.m4a, YYYY-MM-DD-story-female.m4a
#  - 정리: 기본 45일이 지난 오래된 오디오 파일은 자동 정리하여 저장소 용량을 가볍게 유지합니다.

require 'json'
require 'date'
require 'net/http'
require 'uri'
require 'base64'
require 'tempfile'
require 'fileutils'
require 'optparse'

ROOT_DIR = File.expand_path('..', __dir__)
DAYS_DIR = File.join(ROOT_DIR, 'data', 'days')
AUDIO_DIR = File.join(ROOT_DIR, 'data', 'audio')

VOICES = {
  'male' => 'Charon',
  'female' => 'Sulafat'
}.freeze

opts = {
  from: nil,
  days: 8,
  date: nil,
  force: false,
  dry_run: false,
  if_configured: false,
  prune_days: 45,
  concurrency: 2,
  kind: 'all',
  model: ENV['GEMINI_TTS_MODEL'] || 'gemini-3.8-flash-tts'
}

OptionParser.new do |o|
  o.banner = '사용법: ruby scripts/generate_audio.rb [--date YYYY-MM-DD | --from YYYY-MM-DD --days 8] [--kind all|scripture|story] [--force] [--dry-run] [--if-configured]'
  o.on('--date DATE', '특정 하루만 생성 (YYYY-MM-DD)') { |v| opts[:date] = v }
  o.on('--from DATE', '시작 날짜 (기본: 한국시간 오늘)') { |v| opts[:from] = v }
  o.on('--days N', Integer, '확인할 일수 (기본: 8)') { |v| opts[:days] = v }
  o.on('--kind KIND', '생성 대상: all, scripture, story (기본: all)') { |v| opts[:kind] = v.to_s.downcase }
  o.on('--prune-days N', Integer, '오래된 오디오 자동 정리 기준 일수 (기본: 45, 0이면 정리 안 함)') { |v| opts[:prune_days] = v }
  o.on('--concurrency N', Integer, '동시 생성 수 (기본: 2)') { |v| opts[:concurrency] = [v, 1].max }
  o.on('--key-file PATH', 'API 키 파일 경로 (로컬 테스트용)') { |v| opts[:key_file] = v }
  o.on('--force', '이미 있는 오디오 파일도 다시 생성') { opts[:force] = true }
  o.on('--dry-run', 'API 호출 없이 생성 대상과 대본만 확인') { opts[:dry_run] = true }
  o.on('--if-configured', 'GEMINI_API_KEY 미설정 시 정상 종료') { opts[:if_configured] = true }
end.parse!

FileUtils.mkdir_p(AUDIO_DIR)

kst_today = (Time.now.utc + 9 * 3600).to_date

# 오래된 오디오 파일 정리
if !opts[:dry_run] && opts[:prune_days].to_i > 0
  cutoff = (kst_today - opts[:prune_days]).strftime('%Y-%m-%d')
  Dir.glob(File.join(AUDIO_DIR, '*.m4a')).sort.each do |path|
    m = File.basename(path).match(/\A(\d{4}-\d{2}-\d{2})-/)
    next unless m && m[1] < cutoff

    File.delete(path)
    puts "[오디오 정리] 오래된 파일 삭제: #{File.basename(path)}"
  end
end

target_dates = if opts[:date]
                 [Date.iso8601(opts[:date]).strftime('%Y-%m-%d')]
               else
                 start_date = opts[:from] ? Date.iso8601(opts[:from]) : kst_today
                 (0...opts[:days]).map { |i| (start_date + i).strftime('%Y-%m-%d') }
               end

def spoken_reference(ref_str)
  ref = ref_str.to_s.strip.gsub(/[–—~]/, '-')
  unit = ref.start_with?('시편') ? '편' : '장'

  if (m = ref.match(/\A(.+?)\s+(\d+):(\d+[ab]?)-(\d+):(\d+[ab]?)\z/i))
    "#{m[1]} #{m[2]}#{unit} #{m[3].gsub(/[ab]/i, '')}절에서 #{m[4]}#{unit} #{m[5].gsub(/[ab]/i, '')}절 말씀입니다."
  elsif (m = ref.match(/\A(.+?)\s+(\d+):(\d+[ab]?)-(\d+[ab]?)\z/i))
    "#{m[1]} #{m[2]}#{unit} #{m[3].gsub(/[ab]/i, '')}절에서 #{m[4].gsub(/[ab]/i, '')}절 말씀입니다."
  elsif (m = ref.match(/\A(.+?)\s+(\d+):(\d+[ab]?)\z/i))
    "#{m[1]} #{m[2]}#{unit} #{m[3].gsub(/[ab]/i, '')}절 말씀입니다."
  elsif (m = ref.match(/\A(.+?)\s+(\d+)-(\d+)장?\z/))
    "#{m[1]} #{m[2]}#{unit}에서 #{m[3]}#{unit} 말씀입니다."
  else
    "#{ref} 말씀입니다."
  end
end

def build_transcript(day)
  intro = spoken_reference(day['reference'])
  lines = (day['verses'] || []).map do |v|
    txt = v['text'].to_s.strip
    next nil if txt.empty? || txt == '(없음)'

    clean = txt.gsub(/\(셀라\)/, '').gsub(/\s+/, ' ').strip
    clean += '.' unless clean.match?(/[.?!]\z/)
    clean
  end.compact
  "#{intro}\n\n#{lines.join("\n\n")}"
end

def build_story_transcript(day)
  st = day['story'].is_a?(Hash) ? day['story'] : {}
  ctx = day['context'].is_a?(Hash) ? day['context'] : {}
  app = day['application'].is_a?(Hash) ? day['application'] : {}

  title = day['title'].to_s.strip
  ref = day['reference'].to_s.strip
  narrative = st['narrative'].to_s.strip
  if narrative.empty?
    narrative = "#{ctx['summary'].to_s.strip} 오늘 본문은 지금 내 삶 가운데 찾아오시는 하나님을 따뜻하게 만나도록 초대합니다.".strip
  end
  verse = app['defaultVerseText'].to_s.strip
  takeaway = st['takeaway'].to_s.strip
  prayer = st['prayer'].to_s.strip
  prayer = day['openingPrayer'].to_s.strip if prayer.empty?

  parts = []
  parts << "오늘의 이야기. #{title}. #{spoken_reference(ref)}" unless title.empty?
  parts << narrative unless narrative.empty?
  parts << "오늘 붙잡을 한 구절입니다. #{verse}" unless verse.empty?
  parts << takeaway unless takeaway.empty?
  parts << "함께 기도하겠습니다. #{prayer}" unless prayer.empty?
  parts.join("\n\n")
end

include_scripture = %w[all scripture].include?(opts[:kind])
include_story = %w[all story].include?(opts[:kind])

jobs = []
target_dates.each do |d|
  day_path = File.join(DAYS_DIR, "#{d}.json")
  next unless File.exist?(day_path)

  day = JSON.parse(File.read(day_path, encoding: 'UTF-8'))
  next if JSON.generate(day).include?('TODO')

  if include_scripture
    transcript = build_transcript(day)
    VOICES.each do |voice_key, voice_name|
      out_path = File.join(AUDIO_DIR, "#{d}-#{voice_key}.m4a")
      if File.exist?(out_path) && File.size(out_path) > 10_000 && !opts[:force]
        puts "[건너뜀] #{File.basename(out_path)} — 이미 생성되어 있습니다."
        next
      end
      jobs << {
        date: d,
        voice_key: voice_key,
        voice_name: voice_name,
        transcript: transcript,
        out_path: out_path,
        reference: day['reference']
      }
    end
  end

  if include_story
    story_transcript = build_story_transcript(day)
    VOICES.each do |voice_key, voice_name|
      out_path = File.join(AUDIO_DIR, "#{d}-story-#{voice_key}.m4a")
      if File.exist?(out_path) && File.size(out_path) > 8_000 && !opts[:force]
        puts "[건너뜀] #{File.basename(out_path)} — 이미 생성되어 있습니다."
        next
      end
      jobs << {
        date: d,
        voice_key: "story-#{voice_key}",
        voice_name: voice_name,
        transcript: story_transcript,
        out_path: out_path,
        reference: "#{day['reference']} (스토리)"
      }
    end
  end
end

if jobs.empty?
  puts '[완료] 새로 생성할 오디오 파일이 없습니다.'
  exit 0
end

puts "[대상] 생성할 오디오 #{jobs.size}개: #{jobs.map { |j| "#{j[:date]}-#{j[:voice_key]}" }.join(', ')}"

if opts[:dry_run]
  puts "--- 샘플 대본 (#{jobs.first[:reference]}) ---"
  puts jobs.first[:transcript][0, 400]
  puts '[dry-run] API 호출 없이 종료합니다.'
  exit 0
end

api_key = ENV['GEMINI_API_KEY'].to_s.strip
if api_key.empty? && opts[:key_file] && File.exist?(opts[:key_file])
  api_key = File.read(opts[:key_file], encoding: 'UTF-8').strip
end
if api_key.empty?
  msg = '[안내] GEMINI_API_KEY 환경변수가 설정되지 않아 오디오 생성을 건너뜁니다.'
  opts[:if_configured] ? (puts(msg) || exit(0)) : abort(msg)
end

def pcm_to_wav(pcm, rate = 24_000)
  header = ['RIFF', 36 + pcm.bytesize, 'WAVE', 'fmt ', 16, 1, 1, rate, rate * 2, 2, 16, 'data', pcm.bytesize]
           .pack('A4VA4A4VvvVVvvA4V')
  header + pcm
end

def convert_wav_to_m4a!(wav_path, out_path)
  if File.executable?('/usr/bin/afconvert')
    ok = system('/usr/bin/afconvert', '-f', 'm4af', '-d', 'aac', '-b', '48000', '-c', '1', wav_path, out_path)
    raise 'afconvert 변환 실패' unless ok && File.exist?(out_path) && File.size(out_path) > 1000
  else
    ok = system('ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', wav_path, '-c:a', 'aac', '-b:a', '48k', '-ac', '1', '-movflags', '+faststart', out_path)
    raise 'ffmpeg 변환 실패 (ffmpeg 설치 여부를 확인하세요)' unless ok && File.exist?(out_path) && File.size(out_path) > 1000
  end
end

def synthesize_one!(api_key, model, job)
  uri = URI("https://generativelanguage.googleapis.com/v1beta/models/#{model}:generateContent")
  last_err = nil

  3.times do |attempt|
    begin
      req = Net::HTTP::Post.new(uri)
      req['Content-Type'] = 'application/json'
      req['x-goog-api-key'] = api_key
      req.body = JSON.generate(
        contents: [{ parts: [{ text: job[:transcript] }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: job[:voice_name] }
            }
          }
        }
      )

      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 20, read_timeout: 300) { |h| h.request(req) }
      raise "HTTP #{res.code}: #{res.body[0, 300]}" unless res.code == '200'

      payload = JSON.parse(res.body)
      part = (payload.dig('candidates', 0, 'content', 'parts') || []).find { |p| p['inlineData'] }
      raise '오디오 데이터가 비어 있습니다.' unless part

      mime = part.dig('inlineData', 'mimeType').to_s
      raw_bytes = Base64.decode64(part.dig('inlineData', 'data').to_s)
      wav_bytes = if raw_bytes[0, 4] == 'RIFF'
                    raw_bytes
                  else
                    rate = mime[/rate=(\d+)/, 1].to_i
                    pcm_to_wav(raw_bytes, rate.positive? ? rate : 24_000)
                  end

      Tempfile.create(['qt-tts-', '.wav']) do |tmp|
        tmp.binmode
        tmp.write(wav_bytes)
        tmp.flush
        convert_wav_to_m4a!(tmp.path, job[:out_path])
      end

      kb = (File.size(job[:out_path]) / 1024.0).round
      puts "[오디오 완료] #{File.basename(job[:out_path])} (#{job[:voice_name]}, #{kb}KB)"
      return
    rescue StandardError => e
      last_err = e
      warn "[오디오 재시도 #{attempt + 1}] #{job[:date]}-#{job[:voice_key]}: #{e.message}"
      sleep(2 * (attempt + 1))
    end
  end

  raise "[오디오 실패] #{job[:date]}-#{job[:voice_key]}: #{last_err&.message}"
end

queue = Queue.new
jobs.each { |j| queue << j }
errors = Queue.new

workers = Array.new([opts[:concurrency], jobs.size].min) do
  Thread.new do
    until queue.empty?
      job = begin
        queue.pop(true)
      rescue ThreadError
        nil
      end
      next unless job

      begin
        synthesize_one!(api_key, opts[:model], job)
      rescue StandardError => e
        errors << e.message
      end
    end
  end
end
workers.each(&:join)

unless errors.empty?
  msgs = []
  msgs << errors.pop until errors.empty?
  abort msgs.join("\n")
end

puts "[전체 완료] 총 #{jobs.size}개 오디오 파일 생성 완료."
