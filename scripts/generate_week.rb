#!/usr/bin/env ruby
# frozen_string_literal: true

# 주간 큐티 자동 미리 등록 스크립트
#  - data/reading_plan.json 에서 앞으로 N일 치(기본 8일: 오늘~+7일) 장절을 읽습니다.
#  - 성경 본문(개역한글·BSB)은 내장 원문 DB(scripts/bible/)에서 100% 정확히 채웁니다.
#  - 질문(쉬운 3 · 중간 4 · 고급 6), 15초 맥락, 낱말 풀이, 적용 예시는 Gemini API로 생성 후
#    Coffee Break 가드레일을 통과한 파일만 data/days/YYYY-MM-DD.json 으로 저장합니다.
#
# 필요 환경변수: GEMINI_API_KEY (Google AI Studio 무료 발급: https://aistudio.google.com/apikey)
# 사용 예:
#   ruby scripts/generate_week.rb --dry-run
#   GEMINI_API_KEY=... ruby scripts/generate_week.rb --from 2026-11-22 --days 7

require 'json'
require 'date'
require 'net/http'
require 'uri'
require 'openssl'
require 'optparse'
require_relative 'bible_lookup'

ROOT_DIR = File.expand_path('..', __dir__)
PLAN_PATH = File.join(ROOT_DIR, 'data', 'reading_plan.json')
DAYS_DIR = File.join(ROOT_DIR, 'data', 'days')

opts = {
  from: nil,
  days: 8,
  force: false,
  dry_run: false,
  if_configured: false,
  model: (ENV['GEMINI_MODEL'] || 'gemini-4-hydrogen').downcase
}

OptionParser.new do |o|
  o.banner = '사용법: ruby scripts/generate_week.rb [--from YYYY-MM-DD] [--days 8] [--dry-run] [--force] [--if-configured]'
  o.on('--from DATE', '시작 날짜 (기본: 한국시간 오늘)') { |v| opts[:from] = v }
  o.on('--days N', Integer, '확인할 일수 (기본: 8)') { |v| opts[:days] = v }
  o.on('--model MODEL', 'Gemini 모델명 (기본: gemini-4-hydrogen)') { |v| opts[:model] = v.to_s.strip.downcase }
  o.on('--force', '이미 완성된 날짜 파일도 다시 생성') { opts[:force] = true }
  o.on('--dry-run', 'API 호출 없이 대상 날짜와 장절만 검증') { opts[:dry_run] = true }
  o.on('--if-configured', 'GEMINI_API_KEY 미설정 시 오류 대신 안내만 출력하고 정상 종료') { opts[:if_configured] = true }
end.parse!

abort "읽기표 파일이 없습니다: #{PLAN_PATH}" unless File.exist?(PLAN_PATH)

plan_raw = JSON.parse(File.read(PLAN_PATH, encoding: 'UTF-8'))
entries = plan_raw['entries'].is_a?(Hash) ? plan_raw['entries'] : plan_raw

kst_today = (Time.now.utc + 9 * 3600).to_date
start_date = opts[:from] ? Date.iso8601(opts[:from]) : kst_today
target_dates = (0...opts[:days]).map { |i| (start_date + i).strftime('%Y-%m-%d') }

pending = []
target_dates.each do |d|
  entry = entries[d]
  next unless entry

  ref = entry.is_a?(Hash) ? entry['ref'].to_s : entry.to_s
  hint_title = entry.is_a?(Hash) ? entry['title'].to_s : ''
  next if ref.strip.empty?

  day_path = File.join(DAYS_DIR, "#{d}.json")
  if File.exist?(day_path) && !opts[:force]
    existing = File.read(day_path, encoding: 'UTF-8')
    unless existing.include?('TODO')
      puts "[건너뜀] #{d} (#{ref}) — 이미 완성된 파일이 있습니다."
      next
    end
  end

  parsed = BibleLookup.parse(ref)
  pending << { date: d, ref: ref, hint_title: hint_title, parsed: parsed }
end

if pending.empty?
  puts "[완료] #{start_date}부터 #{opts[:days]}일 이내에 새로 생성할 본문이 없습니다."
  exit 0
end

puts "[대상] 새로 생성할 날짜 #{pending.size}건: #{pending.map { |x| "#{x[:date]}(#{x[:ref]})" }.join(', ')}"

if opts[:dry_run]
  puts '[dry-run] 장절 및 원문 DB 검증 완료. API 호출 없이 종료합니다.'
  exit 0
end

api_key = ENV['GEMINI_API_KEY'].to_s.strip
if api_key.empty?
  msg = '[안내] GEMINI_API_KEY 환경변수가 설정되지 않았습니다. ' \
        'GitHub 저장소 Settings → Secrets and variables → Actions 에 GEMINI_API_KEY 를 등록하면 매주 자동 생성이 작동합니다.'
  if opts[:if_configured]
    puts msg
    exit 0
  else
    abort msg
  end
end

def build_prompt(date_str, labels, verses, hint_title, season_note = nil, retry_errors = nil)
  verses_text = verses.map { |v| "#{v['num']}절: #{v['text']}\n(BSB: #{v['en']})" }.join("\n")
  title_hint_line = hint_title.to_s.strip.empty? ? '' : "- 참고 제목 힌트: #{hint_title}\n"
  season_line = season_note.to_s.strip.empty? ? '' : "- 절기 안내: #{season_note}\n"
  retry_note = retry_errors ? "\n[이전 생성 오류 — 반드시 수정하세요]\n#{retry_errors.join("\n")}\n" : ''

  <<~PROMPT
    당신은 *Coffee Break: Leading Bible Discovery* (Faith Alive Christian Resources, 2014) 성경발견학습 원칙을 따르는 한국 교회(New Song Church) 큐티 집필자입니다.
    아래 성경 본문만을 바탕으로 성도들이 스스로 말씀을 발견하고 삶으로 적용하도록 돕는 JSON을 작성하세요.

    [본문 정보]
    - 날짜: #{date_str}
    - 본문: #{labels[:ko]} (#{labels[:en]})
    #{season_line}#{title_hint_line}#{retry_note}
    [성경 본문]
    #{verses_text}

    [엄격한 작성 규칙]
    1. context.summary는 공백 포함 180자 이내(최대 230자)로 기록자·앞뒤 문맥만 적고, 교훈이나 해석 스포일러는 절대 쓰지 마세요.
    2. context.glossary는 본문 속 낯선 낱말 2~3개를 초신자 눈높이로 풀이하세요.
    3. questionSets는 반드시 아래 문항 수와 고유 id를 지키세요 (Yes/No 질문, 빈칸 채우기 ___, 시험식 질문, 설명 없는 교회 은어 금지):
       - easy (초신자용, 정확히 3문항, id: "easy-1", "easy-2", "easy-3"):
         easy-1(type:"fact", badge:"관찰 · 본문이 말하는 것"), easy-2(type:"fact", badge:"관찰 · 본문이 말하는 것"), easy-3(type:"interpretation", badge:"해석 · 당시 맥락의 의미")
       - medium (일반 성도·집사용, 정확히 4문항, id: "fact-1", "fact-2", "interpret-1", "interpret-2"):
         fact-1(type:"fact", badge:"관찰 · 본문이 말하는 것"), fact-2(type:"fact", badge:"관찰 · 본문이 말하는 것"),
         interpret-1(type:"interpretation", badge:"해석 · 당시 맥락의 의미"), interpret-2(type:"reflection", badge:"성찰 · 내 삶에 비추기")
       - advanced (깊은 묵상용, 정확히 6문항, id: "adv-1" ~ "adv-6"):
         adv-1(type:"structure", badge:"관찰 · 흐름과 구조"), adv-2(type:"fact", badge:"관찰 · 본문이 말하는 것"),
         adv-3(type:"interpretation", badge:"해석 · 당시 맥락의 의미"), adv-4(type:"christ", badge:"해석 · 성경 전체와 그리스도"),
         adv-5(type:"interpretation", badge:"해석 · 당시 맥락의 의미"), adv-6(type:"reflection", badge:"성찰 · 내 삶에 비추기")
       - 모든 문항에 verseHint, leaderNudge(정답 대신 어디를 볼지 짚어주는 힌트), placeholder("예: ..." 형태)를 채우세요.
    4. application은 율법적 숙제가 아닌 하나님의 은혜에서 출발해야 합니다:
       - gracePrompt: 본문에서 나타난 하나님/예수님은 어떤 분인지 묻는 질문
       - defaultVerseNum: 본문 절 번호 중 핵심 구절 번호 1개(위 성경 본문의 절 표기 그대로)
       - suggestions: "내 마음", "가정", "직장·일터", "교회·이웃" 4개 영역 각각 1개씩 총 4개({area, when, action})
       - obstaclePrompt: 작은 순종을 방해할 내 마음의 습관이나 상황을 묻는 질문
       - prayBackTemplate: 반드시 "{verse}"와 "{action}"을 모두 포함한 자연스러운 한국어 한 줄 기도문 (예: 주님, "{verse}" 말씀처럼 ... 오늘 주신 다짐({action}) 따라 걸어가게 하소서. 아멘.)

    [출력 JSON 형식 — 다른 설명 없이 순수 JSON 객체만 출력]
    {
      "title": "짧고 따뜻한 한글 제목",
      "englishTitle": "Short English Title",
      "openingPrayer": "2문장 이내의 시작 기도",
      "icebreaker": "성경 지식 없이 답할 수 있는 일상 마음 열기 질문",
      "context": {
        "author": "기록자 및 배경 1줄",
        "summary": "230자 이내 문맥 설명",
        "glossary": [{ "term": "낱말", "meaning": "쉬운 뜻풀이" }]
      },
      "questionSets": {
        "easy": [ ... 3문항 ... ],
        "medium": [ ... 4문항 ... ],
        "advanced": [ ... 6문항 ... ]
      },
      "application": {
        "gracePrompt": "...",
        "defaultVerseNum": #{verses.first['num'].to_json},
        "suggestions": [
          { "area": "내 마음", "when": "...", "action": "..." },
          { "area": "가정", "when": "...", "action": "..." },
          { "area": "직장·일터", "when": "...", "action": "..." },
          { "area": "교회·이웃", "when": "...", "action": "..." }
        ],
        "obstaclePrompt": "...",
        "prayBackTemplate": "... \"{verse}\" ... ({action}) ... 아멘."
      }
    }
  PROMPT
end

def resolve_fallback_flash_model(api_key, err_body = nil, exclude: nil)
  suggested = err_body.to_s[%r{models/(gemini-[A-Za-z0-9._-]+)}, 1]
  return suggested if suggested && suggested != exclude

  uri = URI('https://generativelanguage.googleapis.com/v1beta/models')
  req = Net::HTTP::Get.new(uri)
  req['x-goog-api-key'] = api_key
  res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 15, read_timeout: 20) { |h| h.request(req) }
  if res.code == '200'
    models = JSON.parse(res.body)['models'] || []
    names = models.select { |m| (m['supportedGenerationMethods'] || []).include?('generateContent') }
                  .map { |m| m['name'].to_s.sub(%r{\Amodels/}, '') }
                  .reject { |n| n == exclude }
    return 'gemini-3.8-flash' if names.include?('gemini-3.8-flash')

    flash = names.select { |n| n.include?('flash') && !n.include?('lite') && !n.include?('image') && !n.include?('tts') && !n.include?('2.5') }.sort.last
    return flash if flash
  end

  exclude == 'gemini-3.8-flash' ? nil : 'gemini-3.8-flash'
rescue StandardError
  exclude == 'gemini-3.8-flash' ? nil : 'gemini-3.8-flash'
end

def call_gemini(api_key, model, prompt, allow_model_fallback: true, use_thinking_config: true)
  uri = URI("https://generativelanguage.googleapis.com/v1beta/models/#{model}:generateContent")
  req = Net::HTTP::Post.new(uri)
  req['Content-Type'] = 'application/json'
  req['x-goog-api-key'] = api_key
  gen_cfg = { responseMimeType: 'application/json' }
  gen_cfg[:thinkingConfig] = { thinkingLevel: 'low' } if use_thinking_config
  req.body = JSON.generate(
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: gen_cfg
  )

  timeout_sec = model.include?('hydrogen') ? 45 : 120
  begin
    res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 20, read_timeout: timeout_sec) { |http| http.request(req) }
  rescue Net::ReadTimeout, Net::OpenTimeout => e
    if allow_model_fallback
      alt = resolve_fallback_flash_model(api_key, nil, exclude: model)
      if alt && alt != model
        warn "[대기열 자동 전환] #{model} 응답 지연(#{timeout_sec}초 초과) → #{alt} 모델로 즉시 전환합니다."
        $active_gemini_model = alt
        return call_gemini(api_key, alt, prompt, allow_model_fallback: false, use_thinking_config: true)
      end
    end
    raise e
  end

  if res.code == '400' && use_thinking_config && res.body.to_s.downcase.include?('thinking')
    return call_gemini(api_key, model, prompt, allow_model_fallback: allow_model_fallback, use_thinking_config: false)
  end
  if %w[404 429 503].include?(res.code) && allow_model_fallback
    alt = resolve_fallback_flash_model(api_key, res.body, exclude: model)
    if alt && alt != model
      warn "[모델 자동 전환] #{model} (HTTP #{res.code}) → #{alt} 모델로 전환합니다."
      $active_gemini_model = alt
      return call_gemini(api_key, alt, prompt, allow_model_fallback: false, use_thinking_config: true)
    end
  end
  raise "Gemini HTTP #{res.code}: #{res.body[0, 400]}" unless res.code == '200'

  payload = JSON.parse(res.body)
  parts = payload.dig('candidates', 0, 'content', 'parts') || []
  ans = parts.reverse.find { |pt| !pt['thought'] && !pt['text'].to_s.strip.empty? } || parts.last || {}
  text = ans['text'].to_s.strip
  text = text.sub(/\A```(?:json)?\s*/i, '').sub(/\s*```\z/, '').strip
  raise 'Gemini 응답이 비어 있습니다.' if text.empty?

  puts "[모델 응답 완료] 사용 모델: #{model}"
  JSON.parse(text)
end

def check_generated(day)
  errs = []
  errs << "배경 요약이 240자를 초과했습니다(#{day.dig('context', 'summary').to_s.length}자)." if day.dig('context', 'summary').to_s.length > 240
  rules = { 'easy' => 3, 'medium' => 4, 'advanced' => 6 }
  sets = day['questionSets'] || {}
  rules.each do |lv, cnt|
    arr = sets[lv]
    if !arr.is_a?(Array) || arr.size != cnt
      errs << "#{lv} 문항 수가 #{cnt}개가 아닙니다(현재 #{arr.is_a?(Array) ? arr.size : 0}개)."
      next
    end
    arr.each_with_index do |q, i|
      %w[id type badge prompt leaderNudge].each { |k| errs << "#{lv}[#{i}].#{k} 누락" if q[k].to_s.strip.empty? }
      errs << "#{lv}[#{i}] 빈칸(___) 포함" if q['prompt'].to_s.include?('___')
    end
  end
  all_ids = sets.values.select { |v| v.is_a?(Array) }.flatten.map { |q| q['id'] }
  errs << '질문 id가 중복되었습니다.' if all_ids.uniq.size != all_ids.size
  tmpl = day.dig('application', 'prayBackTemplate').to_s
  errs << 'prayBackTemplate에 {verse} 또는 {action}이 없습니다.' unless tmpl.include?('{verse}') && tmpl.include?('{action}')
  errs << 'TODO 문자열이 남아 있습니다.' if JSON.generate(day).include?('TODO')
  errs
end

weekdays = %w[일 월 화 수 목 금 토]

pending.each do |item|
  d = Date.iso8601(item[:date])
  wd = weekdays[d.wday]
  labels = BibleLookup.labels(item[:parsed])
  verses = BibleLookup.verses(item[:parsed])

  retry_errors = nil
  saved = false

  3.times do |attempt|
    prompt = build_prompt(item[:date], labels, verses, item[:hint_title], item[:parsed][:note], retry_errors)
    begin
      gen = call_gemini(api_key, $active_gemini_model || opts[:model], prompt)
    rescue Net::ReadTimeout, Net::OpenTimeout, JSON::ParserError => e
      warn "[통신 재시도 #{attempt + 1}] #{item[:date]}: #{e.class} - #{e.message}"
      next
    end

    raw_pick = gen.dig('application', 'defaultVerseNum')
    pick = verses.find { |v| v['num'].to_s == raw_pick.to_s } || verses.first

    day = {
      'date' => item[:date],
      'dayLabel' => "#{d.year}년 #{d.month}월 #{d.day}일 #{wd}요일",
      'shortLabel' => "#{d.month}/#{d.day} (#{wd})",
      'reference' => labels[:ko],
      'englishReference' => labels[:en],
      'title' => gen['title'].to_s.strip.empty? ? item[:hint_title] : gen['title'].to_s.strip,
      'englishTitle' => gen['englishTitle'].to_s.strip,
      'translation' => '개역한글판 (저작권 만료 공개본)',
      'englishTranslation' => 'BSB (Berean Standard Bible, Public Domain)',
      'easyEnglishTranslation' => 'FBV (Free Bible Version, CC BY-SA 4.0)',
      'officialDailyBibleUrl' => 'https://sum.su.or.kr:8888/bible/today',
      'openingPrayer' => gen['openingPrayer'].to_s.strip,
      'icebreaker' => gen['icebreaker'].to_s.strip,
      'context' => gen['context'],
      'verses' => verses,
      'questionSets' => gen['questionSets'],
      'application' => {
        'gracePrompt' => gen.dig('application', 'gracePrompt').to_s.strip,
        'defaultVerseRef' => BibleLookup.verse_ref(item[:parsed], pick['num']),
        'defaultVerseText' => pick['text'],
        'defaultVerseTextEn' => pick['en'],
        'defaultVerseTextFbv' => pick['fbv'],
        'areas' => ['내 마음', '가정', '직장·일터', '교회·이웃'],
        'suggestions' => gen.dig('application', 'suggestions'),
        'obstaclePrompt' => gen.dig('application', 'obstaclePrompt').to_s.strip,
        'prayBackTemplate' => gen.dig('application', 'prayBackTemplate').to_s.strip
      }
    }

    errs = check_generated(day)
    if errs.empty?
      out_path = File.join(DAYS_DIR, "#{item[:date]}.json")
      File.write(out_path, JSON.pretty_generate(day) + "\n", encoding: 'UTF-8')
      puts "[생성 완료] #{item[:date]} · #{labels[:ko]} (#{day['title']})"
      saved = true
      break
    else
      warn "[재시도 #{attempt + 1}] #{item[:date]} 검증 오류: #{errs.join('; ')}"
      retry_errors = errs
    end
  end

  abort "[실패] #{item[:date]} 큐티 생성이 가드레일 검증을 통과하지 못했습니다." unless saved
end
