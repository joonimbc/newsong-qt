#!/usr/bin/env ruby
# frozen_string_literal: true

require 'json'
require 'date'
require 'time'
require 'optparse'
require 'cgi'

ROOT_DIR = File.expand_path('..', __dir__)
DAYS_DIR = File.join(ROOT_DIR, 'data', 'days')
SCHEDULE_PATH = File.join(ROOT_DIR, 'data', 'schedule.json')
TODAY_PATH = File.join(ROOT_DIR, 'data', 'today.json')
FALLBACK_JS_PATH = File.join(ROOT_DIR, 'data', 'fallback-data.js')
INDEX_HTML_PATH = File.join(ROOT_DIR, 'index.html')

options = {
  date: nil,
  dry_run: false,
  fallback_latest: false
}

OptionParser.new do |opts|
  opts.banner = '사용법: ruby scripts/publish_daily.rb [--date YYYY-MM-DD] [--fallback-latest] [--dry-run]'
  opts.on('--date DATE', '배포할 날짜 (YYYY-MM-DD, 기본값: 한국 시간 오늘)') { |v| options[:date] = v }
  opts.on('--fallback-latest', '오늘 날짜 파일이 없으면 가장 최근 날짜로 폴백') { options[:fallback_latest] = true }
  opts.on('--dry-run', '파일을 수정하지 않고 검증만 수행') { options[:dry_run] = true }
end.parse!

def kst_today_str
  (Time.now.utc + 9 * 3600).strftime('%Y-%m-%d')
end

def validate_day_data(data, expected_date)
  errors = []
  warnings = []

  required = %w[
    date dayLabel shortLabel reference title translation
    openingPrayer icebreaker context verses questions application
  ]
  required.each do |key|
    val = data[key]
    errors << "필수 필드 누락 또는 비어 있음: #{key}" if val.nil? || (val.respond_to?(:empty?) && val.empty?)
  end

  errors << "날짜 불일치: 파일 내용(#{data['date']}) != 대상 날짜(#{expected_date})" if data['date'] != expected_date

  ctx = data['context']
  if ctx.is_a?(Hash)
    summary = ctx['summary'].to_s
    if summary.length > 240
      errors << "배경 설명(context.summary)이 너무 깁니다 (#{summary.length}자 > 240자). 묵상을 방해하지 않도록 3줄 이내로 줄여 주세요."
    end
    warnings << '저자 정보(context.author)가 비어 있습니다.' if ctx['author'].to_s.strip.empty?
  else
    errors << 'context는 객체여야 합니다.'
  end

  verses = data['verses']
  if !verses.is_a?(Array) || verses.empty?
    errors << 'verses 배열이 비어 있습니다.'
  else
    missing_en = verses.any? { |v| v['en'].to_s.strip.empty? }
    warnings << '일부 절에 영문 본문(verses[].en)이 없습니다.' if missing_en
  end
  warnings << '영문 장절 표기(englishReference)가 비어 있습니다.' if data['englishReference'].to_s.strip.empty?

  questions = data['questions']
  if !questions.is_a?(Array) || questions.length < 2 || questions.length > 5
    errors << "questions 개수는 2~5개여야 합니다 (현재 #{questions.is_a?(Array) ? questions.length : 0}개)."
  else
    questions.each_with_index do |q, idx|
      %w[id type badge prompt].each do |qk|
        errors << "questions[#{idx}].#{qk} 누락" if q[qk].to_s.strip.empty?
      end
      prompt = q['prompt'].to_s
      errors << "questions[#{idx}]에 빈칸 채우기 패턴(___)이 있습니다 (Coffee Break 금기)." if prompt.include?('___')
      warnings << "questions[#{idx}].leaderNudge가 비어 있습니다." if q['leaderNudge'].to_s.strip.empty?
    end
  end

  app = data['application']
  if app.is_a?(Hash)
    errors << 'application.gracePrompt 누락' if app['gracePrompt'].to_s.strip.empty?
    errors << 'application.prayBackTemplate 누락' if app['prayBackTemplate'].to_s.strip.empty?
    if !app['suggestions'].is_a?(Array) || app['suggestions'].empty?
      errors << 'application.suggestions 배열이 비어 있습니다.'
    end
  else
    errors << 'application은 객체여야 합니다.'
  end

  translation = data['translation'].to_s
  if translation.include?('개역개정') && !translation.match?(/허가|허락|승인|licensed/i)
    warnings << '개역개정 번역본 표기 시 대한성서공회 사전 허가 문구 확인이 필요합니다.'
  end

  [errors, warnings]
end

target_date = options[:date] || kst_today_str
Date.iso8601(target_date) # 날짜 형식 검증

target_path = File.join(DAYS_DIR, "#{target_date}.json")
if !File.exist?(target_path) && options[:date].nil? && options[:fallback_latest]
  all_dates = Dir.glob(File.join(DAYS_DIR, '*.json'))
    .map { |p| File.basename(p, '.json') }
    .select { |d| d.match?(/^\d{4}-\d{2}-\d{2}$/) }
    .sort
  past_or_today = all_dates.select { |d| d <= target_date }
  fallback_date = past_or_today.last || all_dates.last
  if fallback_date
    warn "[안내] 오늘(#{target_date}) 파일이 없어 최근 본문(#{fallback_date})으로 폴백합니다."
    target_date = fallback_date
    target_path = File.join(DAYS_DIR, "#{target_date}.json")
  end
end

unless File.exist?(target_path)
  warn "[오류] 대상 날짜 파일이 존재하지 않습니다: #{target_path}"
  exit 1
end

day_data = JSON.parse(File.read(target_path, encoding: 'UTF-8'))
errors, warnings = validate_day_data(day_data, target_date)

warnings.each { |w| warn "[경고] #{w}" }
unless errors.empty?
  errors.each { |e| warn "[검증 실패] #{e}" }
  exit 1
end

puts "[검증 통과] #{target_date} · #{day_data['reference']} (#{day_data['title']})"

if options[:dry_run]
  puts '[dry-run] 파일 수정 없이 종료합니다.'
  exit 0
end

# 1. 공개 가능한 날짜 목록 수집 (target_date 이하만 공개)
existing_schedule = File.exist?(SCHEDULE_PATH) ? JSON.parse(File.read(SCHEDULE_PATH, encoding: 'UTF-8')) : {}
church_name = existing_schedule['churchName'] || 'New Song Church'
church_url = existing_schedule['churchUrl'] || 'https://www.new-song.org/'
qt_domain = existing_schedule['qtDomain'] || 'qt.new-song.org'

available_dates = Dir.glob(File.join(DAYS_DIR, '*.json'))
  .map { |p| File.basename(p, '.json') }
  .select { |d| d.match?(/^\d{4}-\d{2}-\d{2}$/) && d <= target_date }
  .sort
  .reverse

schedule_data = {
  'churchName' => church_name,
  'churchUrl' => church_url,
  'qtDomain' => qt_domain,
  'latestDate' => target_date,
  'availableDates' => available_dates
}

# 2. today.json & schedule.json 갱신
File.write(TODAY_PATH, JSON.pretty_generate(day_data) + "\n", encoding: 'UTF-8')
File.write(SCHEDULE_PATH, JSON.pretty_generate(schedule_data) + "\n", encoding: 'UTF-8')

# 3. fallback-data.js 재생성 (file:// 직접 실행 시에도 동일 데이터 제공)
days_map = {}
available_dates.each do |d|
  days_map[d] = JSON.parse(File.read(File.join(DAYS_DIR, "#{d}.json"), encoding: 'UTF-8'))
end

fallback_payload = {
  'schedule' => schedule_data,
  'days' => days_map
}
fallback_js = "// 자동 생성 파일 (scripts/publish_daily.rb) — file:// 로컬 실행 폴백용\n" \
              "window.QT_FALLBACK_DATA = #{JSON.pretty_generate(fallback_payload)};\n"
File.write(FALLBACK_JS_PATH, fallback_js, encoding: 'UTF-8')

# 4. index.html의 title 및 OG 메타태그 갱신
if File.exist?(INDEX_HTML_PATH)
  html = File.read(INDEX_HTML_PATH, encoding: 'UTF-8')
  safe_title = CGI.escapeHTML("New Song 오늘의 발견 — #{day_data['reference']}")
  safe_og_title = CGI.escapeHTML("#{day_data['shortLabel']} New Song 오늘의 발견 — #{day_data['reference']}")
  safe_og_desc = CGI.escapeHTML("#{day_data['title']} · 본문 앞에서 스스로 발견하고 오늘의 한 걸음으로 적용하는 10분 큐티")

  html.sub!(%r{<title>.*?</title>}m, "<title>#{safe_title}</title>")
  html.sub!(/(<meta\s+property="og:title"\s+content=")[^"]*(")/, "\\1#{safe_og_title}\\2")
  html.sub!(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, "\\1#{safe_og_desc}\\2")

  File.write(INDEX_HTML_PATH, html, encoding: 'UTF-8')
end

puts "[배포 준비 완료] today.json, schedule.json (#{available_dates.size}일치), fallback-data.js, index.html OG 태그 갱신 완료."
