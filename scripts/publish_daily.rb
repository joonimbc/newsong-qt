#!/usr/bin/env ruby
# frozen_string_literal: true

# 매일 큐티 배포 스크립트
#  1) data/days/*.json 의 본문을 개역한글·BSB 원본 데이터로 자동 채움/교정
#  2) Coffee Break 원칙 가드레일 검증 (미완성 파일은 공개 목록에서 제외)
#  3) 한국시간 새벽 공개 시각(기본 05:30) 기준 오늘 본문으로 today.json, schedule.json,
#     fallback-data.js, index.html(OG 태그) 갱신

require 'json'
require 'date'
require 'time'
require 'optparse'
require 'cgi'
require_relative 'bible_lookup'

ROOT_DIR = File.expand_path('..', __dir__)
DAYS_DIR = File.join(ROOT_DIR, 'data', 'days')
SCHEDULE_PATH = File.join(ROOT_DIR, 'data', 'schedule.json')
TODAY_PATH = File.join(ROOT_DIR, 'data', 'today.json')
FALLBACK_JS_PATH = File.join(ROOT_DIR, 'data', 'fallback-data.js')
INDEX_HTML_PATH = File.join(ROOT_DIR, 'index.html')

DEFAULT_SCHEDULE = {
  'churchName' => 'New Song Church',
  'churchUrl' => 'https://www.new-song.org/',
  'qtDomain' => 'qt.new-song.org',
  'siteUrl' => 'https://joonimbc.github.io/newsong-qt/',
  'releaseTime' => '05:30',
  'pushApiUrl' => '',
  'vapidPublicKey' => ''
}.freeze

options = { date: nil, dry_run: false, fallback_latest: false }

OptionParser.new do |opts|
  opts.banner = '사용법: ruby scripts/publish_daily.rb [--date YYYY-MM-DD] [--fallback-latest] [--dry-run]'
  opts.on('--date DATE', '배포할 날짜 (기본값: 한국시간 새벽 공개 시각 기준 오늘)') { |v| options[:date] = v }
  opts.on('--fallback-latest', '오늘 파일이 없으면 가장 최근 공개 가능한 날짜로 폴백') { options[:fallback_latest] = true }
  opts.on('--dry-run', '파일을 수정하지 않고 검증만 수행') { options[:dry_run] = true }
end.parse!

existing_schedule = File.exist?(SCHEDULE_PATH) ? JSON.parse(File.read(SCHEDULE_PATH, encoding: 'UTF-8')) : {}
settings = DEFAULT_SCHEDULE.merge(existing_schedule.select { |k, _| DEFAULT_SCHEDULE.key?(k) })

def kst_release_date(release_time)
  now = Time.now.utc + 9 * 3600
  hh, mm = release_time.to_s.split(':').map(&:to_i)
  minutes = now.hour * 60 + now.min
  date = now.to_date
  date -= 1 if minutes < (hh || 5) * 60 + (mm || 30)
  date.strftime('%Y-%m-%d')
end

# 개역한글·BSB 원본으로 본문을 채우고, 손으로 입력한 본문의 오타를 교정
def fill_scripture!(data, label)
  notes = []
  parsed = BibleLookup.parse(data['reference'])
  canonical = BibleLookup.verses(parsed)
  refs = BibleLookup.labels(parsed)
  current = data['verses'].is_a?(Array) ? data['verses'] : []

  merged = canonical.map do |c|
    mine = current.find { |v| v['num'].to_s == c['num'].to_s } || {}
    if mine['text'] && BibleLookup.normalize(mine['text']) != BibleLookup.normalize(c['text'])
      notes << "#{label} #{c['num']}절 한글 본문을 개역한글 원문으로 교정했습니다."
    end
    if mine['en'] && BibleLookup.normalize(mine['en']) != BibleLookup.normalize(c['en'])
      notes << "#{label} #{c['num']}절 영어 본문을 BSB 원문으로 교정했습니다."
    end
    c
  end
  notes << "#{label} 본문 #{merged.size}절을 자동으로 채웠습니다." if current.empty?

  data['verses'] = merged
  data['englishReference'] = refs[:en] if data['englishReference'].to_s.strip.empty?
  data['translation'] ||= '개역한글판 (저작권 만료 공개본)'
  data['englishTranslation'] ||= 'BSB (Berean Standard Bible, Public Domain)'
  data['easyEnglishTranslation'] ||= 'FBV (Free Bible Version, CC BY-SA 4.0)'

  app = (data['application'] ||= {})
  ref_key = if parsed[:multi_chapter]
              app['defaultVerseRef'].to_s[/(\d+:\d+)\z/, 1]
            else
              app['defaultVerseRef'].to_s[/:(\d+)\z/, 1]
            end
  ref_hit = ref_key && merged.find { |v| v['num'].to_s == ref_key }
  if ref_hit
    # 대표 구절도 항상 원문과 일치하도록 동기화
    app['defaultVerseText'] = ref_hit['text']
    app['defaultVerseTextEn'] = ref_hit['en']
    app['defaultVerseTextFbv'] = ref_hit['fbv']
  elsif app['defaultVerseText'].to_s.strip.empty?
    pick = merged.first
    app['defaultVerseRef'] = BibleLookup.verse_ref(parsed, pick['num'])
    app['defaultVerseText'] = pick['text']
    app['defaultVerseTextEn'] = pick['en']
    app['defaultVerseTextFbv'] = pick['fbv']
  end

  if parsed[:book]['en'] == 'Psalm' && parsed[:from] == 1
    notes << "#{label} 시편 1절 영어 본문의 표제 제거가 자연스러운지 한 번 확인해 주세요."
  end

  fill_reminders!(data)
  fill_story!(data)
  fill_gospel_lens!(data, parsed)
  notes
end

def fill_story!(data)
  st = data['story'].is_a?(Hash) ? data['story'] : {}
  ref = data['reference'].to_s.strip
  title = data['title'].to_s.strip
  summary = data.dig('context', 'summary').to_s.strip
  prayer = data['openingPrayer'].to_s.strip

  if st['narrative'].to_s.strip.empty?
    st['narrative'] = if summary.empty?
                        "오늘 말씀(#{ref})은 '#{title}'라는 주제로 우리에게 다가옵니다. 분주한 마음을 잠시 내려놓고, 오늘도 변함없이 우리와 동행하시는 주님의 음성에 귀 기울여 보세요."
                      else
                        "#{summary} 오늘 본문(#{ref})은 복잡한 지식보다, 지금 내 삶 가운데 찾아오셔서 말씀하시는 하나님을 따뜻하게 만나도록 초대합니다."
                      end
  end
  if st['takeaway'].to_s.strip.empty?
    st['takeaway'] = "오늘 하루, #{ref}의 약속을 마음 한켠에 품고 평안히 걸어가 보세요."
  end
  if st['prayer'].to_s.strip.empty?
    st['prayer'] = prayer.empty? ? "주님, 오늘 주신 #{ref} 말씀을 마음에 품고 하루를 살아가게 하소서. 아멘." : prayer
  end
  data['story'] = st
end

def infer_stage_and_genre(book_en)
  case book_en
  when 'Genesis'
    ['창조 · 타락 · 약속', '역사 서사 — 인물을 무조건 본받기보다, 연약한 인간을 찾아오시는 하나님의 신실하심에 주목해 읽어 보세요.']
  when 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth'
    ['약속과 이스라엘', '구속사 서사·율법 — 율법과 구원의 사건이 장차 오실 예수 그리스도를 어떻게 예표하는지 살피며 읽어 보세요.']
  when '1 Samuel', '2 Samuel', '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther'
    ['왕국과 회복의 역사', '역사서 — 왕과 백성의 실패 속에서도 약속을 지키시는 참된 왕 하나님을 바라보며 읽어 보세요.']
  when 'Psalm'
    ['왕국과 시가·지혜', '시편(기도·찬양시) — 교훈을 외우기보다 감정을 숨기지 않고 하나님께 아뢰는 기도로 천천히 따라 읽어 보세요.']
  when 'Job', 'Proverbs', 'Ecclesiastes', 'Song of Solomon'
    ['왕국과 시가·지혜', '지혜문학 — 세상 처세술이 아니라, 여호와를 경외함에서 시작되는 참된 지혜(그리스도)를 구하며 읽어 보세요.']
  when 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos', 'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi'
    ['심판과 회복의 예언', '선지서 — 죄에 대한 경고 너머, 결국 새 언약과 메시아를 통해 회복하실 하나님의 은혜를 바라보며 읽어 보세요.']
  when 'Matthew', 'Mark', 'Luke', 'John'
    ['예수 그리스도의 복음', '복음서 — 예수님이 하신 말씀과 행동 속에서 그분이 누구시며 왜 오셨는지(십자가와 하나님 나라)를 주목해 보세요.']
  when 'Acts', 'Revelation'
    ['교회와 새 창조', '신약 역사·묵시 — 부활하시고 다스리시는 예수님이 성령을 통해 오늘도 교회를 이끄심을 기억하며 읽어 보세요.']
  else
    ['교회와 새 창조', '서신서 — "무엇을 하라"(명령)에 앞서 "그리스도 안에서 이미 무엇을 받았는가"(복음)를 먼저 확인하며 읽어 보세요.']
  end
end

def populate_cross_ref_fields!(obj)
  cross_ref = obj['crossRef'].to_s.strip
  return if cross_ref.empty?

  cp = BibleLookup.parse(cross_ref)
  cverses = BibleLookup.verses(cp)
  clabels = BibleLookup.labels(cp)
  return if cverses.empty?

  obj['crossRef'] = clabels[:ko]
  obj['crossRefEn'] = clabels[:en]
  obj['crossRefText'] = cverses.map { |v| v['text'] }.join(' ')
  obj['crossRefTextEn'] = cverses.map { |v| v['en'] }.compact.join(' ')
  obj['crossRefTextFbv'] = cverses.map { |v| v['fbv'] }.compact.join(' ')
rescue StandardError
  # 교차 구절 파싱 실패 시 기존 텍스트 유지
end

def fill_gospel_lens!(data, parsed)
  ctx = (data['context'] ||= {})
  stage, genre = infer_stage_and_genre(parsed[:book]['en'])
  ctx['redemptiveStage'] = stage if ctx['redemptiveStage'].to_s.strip.empty?
  ctx['genreTip'] = genre if ctx['genreTip'].to_s.strip.empty?

  gl = data['gospelLens']
  populate_cross_ref_fields!(gl) if gl.is_a?(Hash)

  sets = data['questionSets']
  return unless sets.is_a?(Hash)

  fallback_ref = gl.is_a?(Hash) ? gl['crossRef'].to_s.strip : ''
  sets.each_value do |list|
    next unless list.is_a?(Array)

    list.each do |q|
      next unless q.is_a?(Hash)

      q['crossRef'] = fallback_ref if q['crossRef'].to_s.strip.empty? && q['type'] == 'christ' && !fallback_ref.empty?
      populate_cross_ref_fields!(q) unless q['crossRef'].to_s.strip.empty?
    end
  end
end

def fill_reminders!(data)
  rem = data['reminders'].is_a?(Hash) ? data['reminders'] : {}
  ref = data['reference'].to_s.strip
  title = data['title'].to_s.strip
  def_ref = data.dig('application', 'defaultVerseRef').to_s.strip
  def_ref = ref if def_ref.empty?

  rem['morningTitle'] = "#{ref} · #{title}" if rem['morningTitle'].to_s.strip.empty?
  if rem['morningBody'].to_s.strip.empty?
    rem['morningBody'] = "잠시 숨을 고르고, 오늘 #{ref} 말씀 안에서 주님의 음성을 들어볼까요?"
  end
  rem['eveningTitle'] = "하루를 마치기 전 · #{def_ref}" if rem['eveningTitle'].to_s.strip.empty?
  if rem['eveningBody'].to_s.strip.empty?
    rem['eveningBody'] = "바쁜 하루 속에서도 주님은 여전히 곁에 계세요. 5분만 #{def_ref}에 머물러 보세요."
  end
  data['reminders'] = rem
end

def validate_day_data(data, expected_date)
  errors = []
  warnings = []

  %w[date dayLabel shortLabel reference title openingPrayer icebreaker context verses application].each do |key|
    val = data[key]
    errors << "필수 필드 누락 또는 비어 있음: #{key}" if val.nil? || (val.respond_to?(:empty?) && val.empty?)
  end
  errors << "날짜 불일치: 파일 내용(#{data['date']}) != 파일명(#{expected_date})" if data['date'] != expected_date

  ctx = data['context']
  if ctx.is_a?(Hash)
    summary = ctx['summary'].to_s
    errors << "배경 설명이 너무 깁니다 (#{summary.length}자 > 240자)." if summary.length > 240
    warnings << '저자 정보(context.author)가 비어 있습니다.' if ctx['author'].to_s.strip.empty?
  else
    errors << 'context는 객체여야 합니다.'
  end

  verses = data['verses']
  if verses.is_a?(Array) && !verses.empty?
    errors << '본문 중 비어 있는 절이 있습니다.' if verses.any? { |v| v['text'].to_s.strip.empty? }
  end

  # 수준별 질문: 쉬운(초신자) 2~4 · 중간(성도·집사) 4~5 · 고급(깊은 묵상) 5~8
  level_rules = { 'easy' => 2..4, 'medium' => 4..5, 'advanced' => 5..8 }
  sets = data['questionSets']
  sets = { 'medium' => data['questions'] } if !sets.is_a?(Hash) && data['questions'].is_a?(Array)
  if !sets.is_a?(Hash)
    errors << 'questionSets(easy/medium/advanced)가 없습니다.'
  else
    level_rules.each do |level, range|
      list = sets[level]
      if !list.is_a?(Array) || !range.cover?(list.length)
        msg = "#{level} 질문은 #{range.min}~#{range.max}개여야 합니다 (현재 #{list.is_a?(Array) ? list.length : 0}개)."
        data['questionSets'].is_a?(Hash) ? errors << msg : (warnings << "#{msg} (예전 형식: 중간만 있음)")
        next
      end
      ids = list.map { |q| q['id'] }
      errors << "#{level} 질문 id가 중복됩니다." if ids.uniq.size != ids.size
      list.each_with_index do |q, idx|
        %w[id type badge prompt].each { |qk| errors << "#{level}[#{idx}].#{qk} 누락" if q[qk].to_s.strip.empty? }
        errors << "#{level}[#{idx}]에 빈칸 채우기(___)가 있습니다 (Coffee Break 금기)." if q['prompt'].to_s.include?('___')
        warnings << "#{level}[#{idx}].leaderNudge가 비어 있습니다." if q['leaderNudge'].to_s.strip.empty?
      end
    end
    all_ids = sets.values.select { |v| v.is_a?(Array) }.flatten.map { |q| q['id'] }
    errors << '수준이 다른 질문끼리 id가 겹칩니다 (답변 저장이 섞임).' if all_ids.uniq.size != all_ids.size
  end

  app = data['application']
  if app.is_a?(Hash)
    errors << 'application.gracePrompt 누락' if app['gracePrompt'].to_s.strip.empty?
    errors << 'application.prayBackTemplate 누락' if app['prayBackTemplate'].to_s.strip.empty?
    errors << 'application.suggestions 배열이 비어 있습니다.' if !app['suggestions'].is_a?(Array) || app['suggestions'].empty?
  else
    errors << 'application은 객체여야 합니다.'
  end

  errors << '아직 작성 중(TODO)인 항목이 남아 있습니다.' if JSON.generate(data).include?('TODO')

  [errors, warnings]
end

# 1. 모든 날짜 파일 로드 · 본문 자동 채움 · 검증
valid_days = {}
Dir.glob(File.join(DAYS_DIR, '*.json')).sort.each do |path|
  date = File.basename(path, '.json')
  next unless date.match?(/\A\d{4}-\d{2}-\d{2}\z/)

  raw = File.read(path, encoding: 'UTF-8')
  data = JSON.parse(raw)
  begin
    fill_scripture!(data, date).each { |n| warn "[본문] #{n}" }
  rescue ArgumentError => e
    warn "[제외] #{date}: #{e.message}"
    next
  end

  errors, warnings = validate_day_data(data, date)
  warnings.each { |w| warn "[경고] #{date}: #{w}" }
  unless errors.empty?
    errors.each { |e| warn "[제외] #{date}: #{e}" }
    next
  end

  updated = JSON.pretty_generate(data) + "\n"
  File.write(path, updated, encoding: 'UTF-8') if !options[:dry_run] && updated != raw
  valid_days[date] = data
end

abort '[오류] 공개 가능한 날짜 파일이 하나도 없습니다.' if valid_days.empty?

# 2. 오늘(공개 시각 기준) 대상 날짜 결정
release_date = kst_release_date(settings['releaseTime'])
target_date = options[:date] || release_date
Date.iso8601(target_date)

unless valid_days.key?(target_date)
  if options[:date].nil? && options[:fallback_latest]
    candidates = valid_days.keys.select { |d| d <= target_date }
    fallback = candidates.max || valid_days.keys.min
    warn "[안내] #{target_date} 본문이 없어 #{fallback} 본문을 오늘 본문으로 유지합니다."
    target_date = fallback
  else
    abort "[오류] #{target_date} 본문 파일이 없거나 검증에 실패했습니다."
  end
end

day_data = valid_days[target_date]
puts "[검증 통과] #{target_date} · #{day_data['reference']} (#{day_data['title']}) · 공개 가능 #{valid_days.size}일치"

if options[:dry_run]
  puts '[dry-run] 파일 수정 없이 종료합니다.'
  exit 0
end

# 3. schedule.json (미리 올린 날짜 포함 — 화면이 05:30 KST에 스스로 다음 본문을 엽니다)
schedule_data = settings.merge(
  'latestDate' => target_date,
  'availableDates' => valid_days.keys.sort.reverse
)

File.write(TODAY_PATH, JSON.pretty_generate(day_data) + "\n", encoding: 'UTF-8')
File.write(SCHEDULE_PATH, JSON.pretty_generate(schedule_data) + "\n", encoding: 'UTF-8')

fallback_payload = { 'schedule' => schedule_data, 'days' => valid_days }
File.write(
  FALLBACK_JS_PATH,
  "// 자동 생성 파일 (scripts/publish_daily.rb) — file:// 로컬 실행 폴백용\n" \
  "window.QT_FALLBACK_DATA = #{JSON.pretty_generate(fallback_payload)};\n",
  encoding: 'UTF-8'
)

# 4. index.html 제목 · 카카오톡 미리보기(OG) 갱신
if File.exist?(INDEX_HTML_PATH)
  html = File.read(INDEX_HTML_PATH, encoding: 'UTF-8')
  site_url = settings['siteUrl'].to_s
  site_url += '/' unless site_url.end_with?('/')
  replace_meta = lambda do |prop, value|
    html.sub!(/(<meta\s+property="#{Regexp.escape(prop)}"\s+content=")[^"]*(")/) { "#{Regexp.last_match(1)}#{CGI.escapeHTML(value)}#{Regexp.last_match(2)}" }
  end

  html.sub!(%r{<title>.*?</title>}m, "<title>#{CGI.escapeHTML("New Song 오늘의 발견 — #{day_data['reference']}")}</title>")
  replace_meta.call('og:title', "#{day_data['shortLabel']} New Song 오늘의 발견 — #{day_data['reference']}")
  replace_meta.call('og:description', "#{day_data['title']} · 본문 앞에서 스스로 발견하고 오늘의 한 걸음으로 적용하는 10분 큐티")
  replace_meta.call('og:url', site_url)
  replace_meta.call('og:image', "#{site_url}icons/og-image.png")
  File.write(INDEX_HTML_PATH, html, encoding: 'UTF-8')
end

puts "[배포 준비 완료] 오늘 본문 #{target_date}, 공개 예정 포함 #{valid_days.size}일치, OG 태그 갱신 완료."
