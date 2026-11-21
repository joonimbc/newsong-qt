#!/usr/bin/env ruby
# frozen_string_literal: true

# 저작권이 없는 성경 원본 데이터를 큐티 배포용 JSON으로 변환하는 1회성 도구입니다.
#
# 원본 출처
#   - 한글: 성경전서 개역한글판(1961, 저작재산권 만료)
#           https://github.com/bluesaurel/Korean-Bible-1961-KRV (bible_1961_krv.json)
#   - 영어: Berean Standard Bible (Public Domain)
#           https://bereanbible.com/bsb.txt
#
# 사용법: ruby scripts/build_bible_data.rb <bible_1961_krv.json> <bsb.txt>
# 결과:   scripts/bible/books.json, scripts/bible/krv.json, scripts/bible/bsb.json

require 'json'
require 'fileutils'

krv_src, bsb_src = ARGV
abort '사용법: ruby scripts/build_bible_data.rb <bible_1961_krv.json> <bsb.txt>' unless krv_src && bsb_src

OUT_DIR = File.join(__dir__, 'bible')
FileUtils.mkdir_p(OUT_DIR)

# [BSB 이름, 개역한글 이름, 한글 약어들]
BOOKS = [
  ['Genesis', '창세기', %w[창]], ['Exodus', '출애굽기', %w[출]], ['Leviticus', '레위기', %w[레]],
  ['Numbers', '민수기', %w[민]], ['Deuteronomy', '신명기', %w[신]], ['Joshua', '여호수아', %w[수]],
  ['Judges', '사사기', %w[삿]], ['Ruth', '룻기', %w[룻]], ['1 Samuel', '사무엘상', %w[삼상]],
  ['2 Samuel', '사무엘하', %w[삼하]], ['1 Kings', '열왕기상', %w[왕상]], ['2 Kings', '열왕기하', %w[왕하]],
  ['1 Chronicles', '역대상', %w[대상]], ['2 Chronicles', '역대하', %w[대하]], ['Ezra', '에스라', %w[스]],
  ['Nehemiah', '느헤미야', %w[느]], ['Esther', '에스더', %w[에]], ['Job', '욥기', %w[욥]],
  ['Psalm', '시편', %w[시]], ['Proverbs', '잠언', %w[잠]], ['Ecclesiastes', '전도서', %w[전]],
  ['Song of Solomon', '아가', %w[아]], ['Isaiah', '이사야', %w[사]], ['Jeremiah', '예레미야', %w[렘]],
  ['Lamentations', '예레미야애가', %w[애]], ['Ezekiel', '에스겔', %w[겔]], ['Daniel', '다니엘', %w[단]],
  ['Hosea', '호세아', %w[호]], ['Joel', '요엘', %w[욜]], ['Amos', '아모스', %w[암]],
  ['Obadiah', '오바댜', %w[옵]], ['Jonah', '요나', %w[욘]], ['Micah', '미가', %w[미]],
  ['Nahum', '나훔', %w[나]], ['Habakkuk', '하박국', %w[합]], ['Zephaniah', '스바냐', %w[습]],
  ['Haggai', '학개', %w[학]], ['Zechariah', '스가랴', %w[슥]], ['Malachi', '말라기', %w[말]],
  ['Matthew', '마태복음', %w[마]], ['Mark', '마가복음', %w[막]], ['Luke', '누가복음', %w[눅]],
  ['John', '요한복음', %w[요]], ['Acts', '사도행전', %w[행]], ['Romans', '로마서', %w[롬]],
  ['1 Corinthians', '고린도전서', %w[고전]], ['2 Corinthians', '고린도후서', %w[고후]],
  ['Galatians', '갈라디아서', %w[갈]], ['Ephesians', '에베소서', %w[엡]], ['Philippians', '빌립보서', %w[빌]],
  ['Colossians', '골로새서', %w[골]], ['1 Thessalonians', '데살로니가전서', %w[살전]],
  ['2 Thessalonians', '데살로니가후서', %w[살후]], ['1 Timothy', '디모데전서', %w[딤전]],
  ['2 Timothy', '디모데후서', %w[딤후]], ['Titus', '디도서', %w[딛]], ['Philemon', '빌레몬서', %w[몬]],
  ['Hebrews', '히브리서', %w[히]], ['James', '야고보서', %w[약]], ['1 Peter', '베드로전서', %w[벧전]],
  ['2 Peter', '베드로후서', %w[벧후]], ['1 John', '요한일서', %w[요일]], ['2 John', '요한이서', %w[요이]],
  ['3 John', '요한삼서', %w[요삼]], ['Jude', '유다서', %w[유]], ['Revelation', '요한계시록', %w[계]]
].freeze

SUPERSCRIPTION_START = /\A(For the choirmaster|For the director|For Jeduthun|To the tune|To bring remembrance|According to|With stringed|For the flutes|A Psalm|A psalm|A Song|A song|A love song|A Maskil|A Miktam|A Prayer|A prayer|A Shiggaion|Of David|Of Solomon|Of Asaph|Of the sons|For remembrance|For the dedication|For the Sabbath|For thanksgiving|For the memorial|Of Moses|Of Heman|Of Ethan)/.freeze

# 표제가 "When ..."으로 이어지는 시편 (본문이 When으로 시작하는 114, 126편과 구분)
WHEN_SUPERSCRIPTION_PSALMS = %w[51 54 60].freeze

# BSB는 시편 표제(예: "For the choirmaster. A Psalm of David.")를 1절에 포함하므로 본문만 남깁니다.
def strip_psalm_superscription(text, chapter)
  out = text.dup
  loop do
    starts = out.match?(SUPERSCRIPTION_START) ||
             (WHEN_SUPERSCRIPTION_PSALMS.include?(chapter) && out.start_with?('When '))
    break unless starts
    m = out.match(/\A.*?[.?!][”"’]?\s+/)
    break unless m
    out = out[m[0].length..-1]
  end
  out.sub(/\AHe said: /, '')
end

krv_raw = JSON.parse(File.read(krv_src, encoding: 'UTF-8'))
krv_by_key = {}
krv_raw.each { |b| krv_by_key[b['book'].delete(' ')] = b }

books_meta = []
krv_out = {}
bsb_out = {}

BOOKS.each_with_index do |(en, ko, abbrs), idx|
  id = en
  krv_key = en.delete(' ')
  krv_key = 'Psalms' if en == 'Psalm'
  src = krv_by_key[krv_key] or abort "개역한글 데이터에 #{en}(#{krv_key})이 없습니다."
  krv_out[id] = {}
  src['chapters'].each do |c|
    krv_out[id][c['chapter'].to_s] = c['verses'].each_with_object({}) { |v, h| h[v['verse'].to_s] = v['text'].strip }
  end
  books_meta << { 'id' => id, 'order' => idx + 1, 'ko' => ko, 'en' => en, 'aliases' => abbrs }
  bsb_out[id] = {}
end

File.foreach(bsb_src, encoding: 'bom|utf-8') do |line|
  line = line.strip
  next unless line =~ /\A(.+?) (\d+):(\d+)\t(.*)\z/
  book, ch, vs, text = Regexp.last_match(1), Regexp.last_match(2), Regexp.last_match(3), Regexp.last_match(4).strip
  next unless bsb_out.key?(book)
  text = strip_psalm_superscription(text, ch) if book == 'Psalm' && vs == '1'
  (bsb_out[book][ch] ||= {})[vs] = text
end

File.write(File.join(OUT_DIR, 'books.json'), JSON.pretty_generate(books_meta) + "\n")
File.write(File.join(OUT_DIR, 'krv.json'), JSON.generate(krv_out) + "\n")
File.write(File.join(OUT_DIR, 'bsb.json'), JSON.generate(bsb_out) + "\n")

krv_count = krv_out.values.sum { |b| b.values.sum(&:size) }
bsb_count = bsb_out.values.sum { |b| b.values.sum(&:size) }
puts "완료: 66권 · 개역한글 #{krv_count}절 · BSB #{bsb_count}절 → #{OUT_DIR}"
