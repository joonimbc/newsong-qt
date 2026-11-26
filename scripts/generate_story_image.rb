#!/usr/bin/env ruby
# frozen_string_literal: true

# 일일/주간 스토리 큐티 직관 일러스트(.jpg) 자동 생성 스크립트
#  - 모델: Gemini Flash Image (기본 gemini-2.5-flash-image, 미지원 시 자동 폴백)
#  - 스타일: 글자·인물 얼굴 없이, 따뜻한 수채화·린넨 페이퍼 톤의 상징/풍경 일러스트 (16:9)
#  - 출력: data/images/YYYY-MM-DD.jpg (960px, ~50KB 경량 압축)
#  - 정리: 기본 45일이 지난 오래된 이미지는 자동 정리하여 저장소 용량을 가볍게 유지합니다.

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
IMAGES_DIR = File.join(ROOT_DIR, 'data', 'images')

DEFAULT_MODELS = [
  ENV['GEMINI_IMAGE_MODEL'].to_s.strip,
  'gemini-2.5-flash-image',
  'gemini-2.5-flash-image-preview'
].reject(&:empty?).uniq.freeze

opts = {
  from: nil,
  days: 8,
  date: nil,
  force: false,
  dry_run: false,
  if_configured: false,
  prune_days: 45,
  key_file: nil
}

OptionParser.new do |o|
  o.banner = '사용법: ruby scripts/generate_story_image.rb [--date YYYY-MM-DD | --from YYYY-MM-DD --days 8] [--force] [--dry-run] [--if-configured]'
  o.on('--date DATE', '특정 하루만 생성 (YYYY-MM-DD)') { |v| opts[:date] = v }
  o.on('--from DATE', '시작 날짜 (기본: 한국시간 오늘)') { |v| opts[:from] = v }
  o.on('--days N', Integer, '확인할 일수 (기본: 8)') { |v| opts[:days] = v }
  o.on('--prune-days N', Integer, '오래된 이미지 자동 정리 기준 일수 (기본: 45, 0이면 정리 안 함)') { |v| opts[:prune_days] = v }
  o.on('--key-file PATH', 'API 키 파일 경로 (로컬 테스트용)') { |v| opts[:key_file] = v }
  o.on('--force', '이미 있는 이미지도 다시 생성') { opts[:force] = true }
  o.on('--dry-run', 'API 호출 없이 생성 대상과 프롬프트만 확인') { opts[:dry_run] = true }
  o.on('--if-configured', 'GEMINI_API_KEY 미설정 시 정상 종료') { opts[:if_configured] = true }
end.parse!

FileUtils.mkdir_p(IMAGES_DIR)

kst_today = (Time.now.utc + 9 * 3600).to_date

if !opts[:dry_run] && opts[:prune_days].to_i > 0
  cutoff = (kst_today - opts[:prune_days]).strftime('%Y-%m-%d')
  Dir.glob(File.join(IMAGES_DIR, '*.jpg')).sort.each do |path|
    m = File.basename(path).match(/\A(\d{4}-\d{2}-\d{2})\.jpg\z/)
    next unless m && m[1] < cutoff

    File.delete(path)
    puts "[이미지 정리] 오래된 파일 삭제: #{File.basename(path)}"
  end
end

target_dates = if opts[:date]
                 [Date.iso8601(opts[:date]).strftime('%Y-%m-%d')]
               else
                 start_date = opts[:from] ? Date.iso8601(opts[:from]) : kst_today
                 (0...opts[:days]).map { |i| (start_date + i).strftime('%Y-%m-%d') }
               end

def build_image_prompt(day)
  en_ref = day['englishReference'].to_s.strip
  en_title = day['englishTitle'].to_s.strip
  ko_title = day['title'].to_s.strip
  story_nar = day.dig('story', 'narrative').to_s.strip
  verse_en = day.dig('application', 'defaultVerseTextFbv').to_s.strip
  verse_en = day.dig('application', 'defaultVerseTextEn').to_s.strip if verse_en.empty?

  theme = [en_title, en_ref, ko_title].reject(&:empty?).join(' — ')
  verse_hint = verse_en.empty? ? story_nar[0, 180] : verse_en

  <<~PROMPT.strip
    Create a serene, poetic, minimalist editorial book illustration in warm watercolor and soft gouache on textured cream linen paper (#F8F5EE) with gentle sage green (#3E5845), warm amber sunlight, and soft earth tones.
    Subject inspired by the Bible passage "#{theme}": #{verse_hint}
    Visual approach: A peaceful, intuitive symbolic nature or landscape scene (such as morning sunlight breaking over hills, soaring eagle in golden dawn sky, calm still waters, shepherd path, gentle olive branch, or open window light) that immediately conveys the emotional warmth and hope of the passage.
    Strict rules:
    - Landscape 16:9 composition, airy negative space, quiet meditative mood.
    - ABSOLUTELY NO text, NO letters, NO words, NO numbers, NO calligraphy, NO watermarks, NO borders or frames.
    - NO close-up human faces or photorealistic portraits; if a figure appears at all, only a tiny distant silhouette.
  PROMPT
end

jobs = []
target_dates.each do |d|
  day_path = File.join(DAYS_DIR, "#{d}.json")
  next unless File.exist?(day_path)

  day = JSON.parse(File.read(day_path, encoding: 'UTF-8'))
  next if JSON.generate(day).include?('TODO')

  out_path = File.join(IMAGES_DIR, "#{d}.jpg")
  if File.exist?(out_path) && File.size(out_path) > 5_000 && !opts[:force]
    puts "[건너뜀] #{File.basename(out_path)} — 이미 생성되어 있습니다."
    next
  end

  jobs << {
    date: d,
    reference: day['reference'],
    prompt: build_image_prompt(day),
    out_path: out_path
  }
end

if jobs.empty?
  puts '[완료] 새로 생성할 스토리 이미지가 없습니다.'
  exit 0
end

puts "[대상] 생성할 스토리 이미지 #{jobs.size}개: #{jobs.map { |j| j[:date] }.join(', ')}"

if opts[:dry_run]
  puts "--- 샘플 프롬프트 (#{jobs.first[:reference]}) ---"
  puts jobs.first[:prompt]
  puts '[dry-run] API 호출 없이 종료합니다.'
  exit 0
end

api_key = ENV['GEMINI_API_KEY'].to_s.strip
if api_key.empty? && opts[:key_file] && File.exist?(opts[:key_file])
  api_key = File.read(opts[:key_file], encoding: 'UTF-8').strip
end
if api_key.empty?
  msg = '[안내] GEMINI_API_KEY 환경변수가 설정되지 않아 스토리 이미지 생성을 건너뜁니다.'
  opts[:if_configured] ? (puts(msg) || exit(0)) : abort(msg)
end

def save_compressed_jpg!(raw_bytes, mime, out_path)
  ext = mime.include?('jpeg') || mime.include?('jpg') ? '.jpg' : '.png'
  Tempfile.create(['qt-img-', ext]) do |tmp|
    tmp.binmode
    tmp.write(raw_bytes)
    tmp.flush

    if system('which ffmpeg >/dev/null 2>&1')
      ok = system('ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', tmp.path, '-vf', 'scale=960:-2', '-q:v', '4', out_path)
      return if ok && File.exist?(out_path) && File.size(out_path) > 3_000
    elsif File.executable?('/usr/bin/sips')
      ok = system('/usr/bin/sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '960', tmp.path, '--out', out_path, out: File::NULL, err: File::NULL)
      return if ok && File.exist?(out_path) && File.size(out_path) > 3_000
    end

    File.binwrite(out_path, raw_bytes)
  end
end

def generate_one!(api_key, job)
  last_err = nil

  DEFAULT_MODELS.each do |model|
    uri = URI("https://generativelanguage.googleapis.com/v1beta/models/#{model}:generateContent")
    2.times do |attempt|
      begin
        req = Net::HTTP::Post.new(uri)
        req['Content-Type'] = 'application/json'
        req['x-goog-api-key'] = api_key
        req.body = JSON.generate(
          contents: [{ parts: [{ text: job[:prompt] }] }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: '16:9' }
          }
        )

        res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 20, read_timeout: 180) { |h| h.request(req) }
        if res.code == '404'
          last_err = StandardError.new("Model #{model} HTTP 404")
          break
        end
        raise "HTTP #{res.code}: #{res.body[0, 300]}" unless res.code == '200'

        payload = JSON.parse(res.body)
        parts = payload.dig('candidates', 0, 'content', 'parts') || []
        img_part = parts.find { |p| p['inlineData'] && p.dig('inlineData', 'data').to_s.length > 100 }
        raise '이미지 데이터가 비어 있습니다.' unless img_part

        mime = img_part.dig('inlineData', 'mimeType').to_s
        raw_bytes = Base64.decode64(img_part.dig('inlineData', 'data').to_s)
        save_compressed_jpg!(raw_bytes, mime, job[:out_path])

        kb = (File.size(job[:out_path]) / 1024.0).round
        puts "[이미지 완료] #{File.basename(job[:out_path])} (#{model}, #{kb}KB)"
        return
      rescue StandardError => e
        last_err = e
        warn "[이미지 재시도 #{attempt + 1}] #{job[:date]} (#{model}): #{e.message}"
        sleep(2 * (attempt + 1))
      end
    end
  end

  raise "[이미지 실패] #{job[:date]}: #{last_err&.message}"
end

failed = []
jobs.each do |job|
  begin
    generate_one!(api_key, job)
  rescue StandardError => e
    warn e.message
    failed << e.message
  end
end

if failed.any?
  warn "[주의] 일부 스토리 이미지 생성 실패 (#{failed.size}건)"
  exit(1) unless opts[:if_configured]
end

puts "[전체 완료] 스토리 이미지 처리 완료."
