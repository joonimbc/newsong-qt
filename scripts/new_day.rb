#!/usr/bin/env ruby
# frozen_string_literal: true

# 새 날짜 큐티 파일 뼈대 만들기 — 장절만 넣으면 개역한글·BSB 본문이 자동으로 채워집니다.
#
# 사용 예)
#   ruby scripts/new_day.rb --date 2026-11-22 --ref "시편 22:22-31" --title "다 함께 부를 노래"
#
# 생성된 data/days/YYYY-MM-DD.json 에서 "TODO" 부분(질문·적용 등)을 채우면 됩니다.
# TODO가 남아 있는 파일은 publish_daily.rb가 자동으로 공개 목록에서 제외합니다.

require 'json'
require 'date'
require 'optparse'
require_relative 'bible_lookup'

opts = {}
OptionParser.new do |o|
  o.banner = '사용법: ruby scripts/new_day.rb --date YYYY-MM-DD --ref "시편 22:22-31" [--title "제목"] [--force]'
  o.on('--date DATE') { |v| opts[:date] = v }
  o.on('--ref REF') { |v| opts[:ref] = v }
  o.on('--title TITLE') { |v| opts[:title] = v }
  o.on('--force', '이미 있는 파일 덮어쓰기') { opts[:force] = true }
end.parse!

opts.each { |k, v| opts[k] = v.dup.force_encoding('UTF-8') if v.is_a?(String) }

abort '--date 와 --ref 가 필요합니다.' unless opts[:date] && opts[:ref]

date = Date.iso8601(opts[:date])
path = File.expand_path("../data/days/#{opts[:date]}.json", __dir__)
abort "이미 파일이 있습니다: #{path} (덮어쓰려면 --force)" if File.exist?(path) && !opts[:force]

parsed = BibleLookup.parse(opts[:ref])
labels = BibleLookup.labels(parsed)
verses = BibleLookup.verses(parsed)
weekdays = %w[일 월 화 수 목 금 토]
wd = weekdays[date.wday]

day = {
  'date' => opts[:date],
  'dayLabel' => "#{date.year}년 #{date.month}월 #{date.day}일 #{wd}요일",
  'shortLabel' => "#{date.month}/#{date.day} (#{wd})",
  'reference' => labels[:ko],
  'englishReference' => labels[:en],
  'title' => opts[:title] || 'TODO 오늘의 제목',
  'englishTitle' => '',
  'translation' => '개역한글판 (저작권 만료 공개본)',
  'englishTranslation' => 'BSB (Berean Standard Bible, Public Domain)',
  'officialDailyBibleUrl' => 'https://sum.su.or.kr:8888/bible/today',
  'openingPrayer' => 'TODO 2문장 이내의 시작 기도',
  'icebreaker' => 'TODO 누구나 답할 수 있는 마음 열기 질문',
  'context' => {
    'author' => 'TODO 기록자 (수신자)',
    'summary' => 'TODO 240자 이내 배경 (해석 스포일러 금지)',
    'glossary' => [{ 'term' => 'TODO', 'meaning' => 'TODO 쉬운 뜻풀이' }]
  },
  'verses' => verses,
  'questionSets' => {
    # 쉬운: 초신자 — 본문에서 바로 찾을 수 있는 관찰 + 쉬운 느낌 질문 (교회 용어 X)
    'easy' => [
      { 'id' => 'easy-1', 'type' => 'fact', 'badge' => '관찰 · 본문이 말하는 것', 'prompt' => 'TODO 쉬운 관찰 질문 1', 'verseHint' => '', 'leaderNudge' => 'TODO 힌트', 'placeholder' => '' },
      { 'id' => 'easy-2', 'type' => 'fact', 'badge' => '관찰 · 본문이 말하는 것', 'prompt' => 'TODO 쉬운 관찰 질문 2', 'verseHint' => '', 'leaderNudge' => 'TODO 힌트', 'placeholder' => '' },
      { 'id' => 'easy-3', 'type' => 'interpretation', 'badge' => '해석 · 당시 맥락의 의미', 'prompt' => 'TODO 쉬운 느낌·생각 질문', 'verseHint' => '', 'leaderNudge' => 'TODO 힌트', 'placeholder' => '' }
    ],
    # 중간: 성도·집사 — 관찰 2 + 해석 1
    'medium' => [
      { 'id' => 'fact-1', 'type' => 'fact', 'badge' => '관찰 · 본문이 말하는 것', 'prompt' => 'TODO 관찰 질문 1', 'verseHint' => '', 'leaderNudge' => 'TODO 힌트', 'placeholder' => '' },
      { 'id' => 'fact-2', 'type' => 'fact', 'badge' => '관찰 · 본문이 말하는 것', 'prompt' => 'TODO 관찰 질문 2', 'verseHint' => '', 'leaderNudge' => 'TODO 힌트', 'placeholder' => '' },
      { 'id' => 'interpret-1', 'type' => 'interpretation', 'badge' => '해석 · 당시 맥락의 의미', 'prompt' => 'TODO 해석 질문', 'verseHint' => '', 'leaderNudge' => 'TODO 힌트', 'placeholder' => '' }
    ],
    # 고급: 깊은 묵상 — 구조, 대조, 해석, 그리스도 연결, 신학적 질문, 삶의 성찰 (6문항)
    'advanced' => [
      { 'id' => 'adv-1', 'type' => 'structure', 'badge' => '관찰 · 흐름과 구조', 'prompt' => 'TODO 본문 구조·흐름 질문', 'verseHint' => '', 'leaderNudge' => 'TODO 힌트', 'placeholder' => '' },
      { 'id' => 'adv-2', 'type' => 'fact', 'badge' => '관찰 · 본문이 말하는 것', 'prompt' => 'TODO 대조·반복 관찰 질문', 'verseHint' => '', 'leaderNudge' => 'TODO 힌트', 'placeholder' => '' },
      { 'id' => 'adv-3', 'type' => 'interpretation', 'badge' => '해석 · 당시 맥락의 의미', 'prompt' => 'TODO 핵심 구절 해석 질문', 'verseHint' => '', 'leaderNudge' => 'TODO 힌트', 'placeholder' => '' },
      { 'id' => 'adv-4', 'type' => 'christ', 'badge' => '해석 · 성경 전체와 그리스도', 'prompt' => 'TODO 성경 전체·그리스도 연결 질문', 'verseHint' => '', 'leaderNudge' => 'TODO 힌트', 'placeholder' => '' },
      { 'id' => 'adv-5', 'type' => 'interpretation', 'badge' => '해석 · 당시 맥락의 의미', 'prompt' => 'TODO 신학적으로 깊은 질문', 'verseHint' => '', 'leaderNudge' => 'TODO 힌트', 'placeholder' => '' },
      { 'id' => 'adv-6', 'type' => 'reflection', 'badge' => '성찰 · 내 삶에 비추기', 'prompt' => 'TODO 삶을 깊이 돌아보는 질문', 'verseHint' => '', 'leaderNudge' => 'TODO 힌트', 'placeholder' => '' }
    ]
  },
  'application' => {
    'gracePrompt' => 'TODO 오늘 본문에서 만난 하나님은 어떤 분인가요?',
    'defaultVerseRef' => BibleLookup.verse_ref(parsed, verses.first['num']),
    'defaultVerseText' => verses.first['text'],
    'defaultVerseTextEn' => verses.first['en'],
    'areas' => ['내 마음', '가정', '직장·일터', '교회·이웃'],
    'suggestions' => ['내 마음', '가정', '직장·일터', '교회·이웃'].map do |a|
      { 'area' => a, 'when' => 'TODO 언제', 'action' => 'TODO 구체적인 작은 한 걸음' }
    end,
    'obstaclePrompt' => 'TODO 순종을 방해하는 마음이나 상황은 무엇인가요?',
    'prayBackTemplate' => '주님, "{verse}" 말씀처럼 ... 오늘 주신 다짐({action}) 따라 걸어가게 하소서. 아멘.'
  }
}

File.write(path, JSON.pretty_generate(day) + "\n", encoding: 'UTF-8')
puts "생성 완료: #{path}"
puts "본문: #{labels[:ko]} (#{verses.size}절, 개역한글 + BSB 자동 입력)"
puts '다음 단계: 파일 안의 TODO를 채운 뒤 저장소에 올리면 해당 날짜 새벽 05:30에 자동 공개됩니다.'
