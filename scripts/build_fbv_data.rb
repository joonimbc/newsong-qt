#!/usr/bin/env ruby
# frozen_string_literal: true

# Free Bible Version (FBV, CC BY-SA 4.0, https://ebible.org/engfbv/) VPL 텍스트를
# scripts/bible/fbv.json 으로 변환하는 도구입니다.

require 'json'
require 'fileutils'

vpl_src = ARGV[0] || '/tmp/engfbv_vpl/engfbv_vpl.txt'
abort "파일을 찾을 수 없습니다: #{vpl_src}" unless File.exist?(vpl_src)

OUT_DIR = File.join(__dir__, 'bible')
FileUtils.mkdir_p(OUT_DIR)

CODE_TO_BOOK = {
  'GEN' => 'Genesis', 'EXO' => 'Exodus', 'LEV' => 'Leviticus', 'NUM' => 'Numbers',
  'DEU' => 'Deuteronomy', 'JOS' => 'Joshua', 'JDG' => 'Judges', 'RUT' => 'Ruth',
  '1SA' => '1 Samuel', '2SA' => '2 Samuel', '1KI' => '1 Kings', '2KI' => '2 Kings',
  '1CH' => '1 Chronicles', '2CH' => '2 Chronicles', 'EZR' => 'Ezra', 'NEH' => 'Nehemiah',
  'EST' => 'Esther', 'JOB' => 'Job', 'PSA' => 'Psalm', 'PRO' => 'Proverbs',
  'ECC' => 'Ecclesiastes', 'SOL' => 'Song of Solomon', 'ISA' => 'Isaiah', 'JER' => 'Jeremiah',
  'LAM' => 'Lamentations', 'EZE' => 'Ezekiel', 'DAN' => 'Daniel', 'HOS' => 'Hosea',
  'JOE' => 'Joel', 'AMO' => 'Amos', 'OBA' => 'Obadiah', 'JON' => 'Jonah',
  'MIC' => 'Micah', 'NAH' => 'Nahum', 'HAB' => 'Habakkuk', 'ZEP' => 'Zephaniah',
  'HAG' => 'Haggai', 'ZEC' => 'Zechariah', 'MAL' => 'Malachi',
  'MAT' => 'Matthew', 'MAR' => 'Mark', 'LUK' => 'Luke', 'JOH' => 'John',
  'ACT' => 'Acts', 'ROM' => 'Romans', '1CO' => '1 Corinthians', '2CO' => '2 Corinthians',
  'GAL' => 'Galatians', 'EPH' => 'Ephesians', 'PHI' => 'Philippians', 'COL' => 'Colossians',
  '1TH' => '1 Thessalonians', '2TH' => '2 Thessalonians', '1TI' => '1 Timothy',
  '2TI' => '2 Timothy', 'TIT' => 'Titus', 'PHM' => 'Philemon', 'HEB' => 'Hebrews',
  'JAM' => 'James', '1PE' => '1 Peter', '2PE' => '2 Peter',
  '1JO' => '1 John', '2JO' => '2 John', '3JO' => '3 John', 'JUD' => 'Jude',
  'REV' => 'Revelation'
}.freeze

FBV_SUPERSCRIPTION_START = /\A(
  For\s+the\s+music\s+director|
  For\s+Jeduthun|
  To\s+the\s+music\s+director|
  To\s+the\s+Sheminith|
  To\s+the\s+tune|
  To\s+be\s+accompanied|
  With\s+stringed\s+instruments|
  On\s+the\s+gittith|
  According\s+to\s+|
  A\s+psalm|
  A\s+song|
  A\s+love\s+song|
  A\s+prayer|
  A\s+maskil|
  A\s+miktam|
  A\s+shiggaion|
  For\s+a\s+memorial
)/x.freeze

WHEN_PSALMS = %w[51 52 54 60].freeze

def strip_fbv_psalm_superscription(text, chapter)
  out = text.dup.strip
  # 마침표가 누락된 3개 시편 표제 보정 (Ps 85, 88, 89)
  out.sub!(/\A(For the music director\. A psalm of the descendants of Korah)\s+(Lord,)/, '\1. \2')
  out.sub!(/\A(.*?A maskil by Heman the Ezrahite)\s+(Lord,)/, '\1. \2')
  out.sub!(/\A(A psalm \(maskil\) of Ethan the Ezraite)\s+(I will)/, '\1. \2')
  out.sub!(/\AAleph\s+/, '') if chapter == '119'

  loop do
    starts = out.match?(FBV_SUPERSCRIPTION_START) ||
             (WHEN_PSALMS.include?(chapter) && out.start_with?('When '))
    break unless starts

    m = out.match(/\A.*?[.?!:][”"’]?\s+/)
    break unless m

    out = out[m[0].length..-1].strip
  end
  out.sub(/\AHe sang:\s+/, '')
end

fbv_out = {}
CODE_TO_BOOK.each_value { |b| fbv_out[b] = {} }

File.foreach(vpl_src, encoding: 'bom|utf-8') do |raw_line|
  line = raw_line.chomp.strip
  next unless line =~ /\A(\S+)\s+(\d+):(\d+)\s+(.*)\z/

  code, ch, vs, txt = Regexp.last_match(1), Regexp.last_match(2), Regexp.last_match(3), Regexp.last_match(4).strip
  book = CODE_TO_BOOK[code]
  next unless book

  txt = strip_fbv_psalm_superscription(txt, ch) if book == 'Psalm' && vs == '1'
  (fbv_out[book][ch] ||= {})[vs] = txt
end

empty_books = fbv_out.select { |_, chs| chs.empty? }.keys
abort "비어 있는 성경 권이 있습니다: #{empty_books}" unless empty_books.empty?

out_path = File.join(OUT_DIR, 'fbv.json')
File.write(out_path, JSON.generate(fbv_out) + "\n", encoding: 'UTF-8')

verse_count = fbv_out.values.sum { |b| b.values.sum(&:size) }
puts "완료: 66권 · 쉬운 영어(FBV) #{verse_count}절 → #{out_path} (#{(File.size(out_path) / 1024.0 / 1024.0).round(2)}MB)"
