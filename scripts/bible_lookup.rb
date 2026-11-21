# frozen_string_literal: true

require 'json'

# 저작권 없는 개역한글판(1961) · BSB 데이터에서 장절로 본문을 찾아 주는 도우미
module BibleLookup
  DIR = File.join(__dir__, 'bible')

  module_function

  def books
    @books ||= JSON.parse(File.read(File.join(DIR, 'books.json'), encoding: 'UTF-8'))
  end

  def krv
    @krv ||= JSON.parse(File.read(File.join(DIR, 'krv.json'), encoding: 'UTF-8'))
  end

  def bsb
    @bsb ||= JSON.parse(File.read(File.join(DIR, 'bsb.json'), encoding: 'UTF-8'))
  end

  def find_book(name)
    key = name.to_s.strip.delete(' ').downcase
    books.find do |b|
      [b['ko'], b['en'], *b['aliases']].any? { |n| n.delete(' ').downcase == key } ||
        (b['en'] == 'Psalm' && key == 'psalms')
    end
  end

  # "시편 22:1–12", "시 22:1-12", "Psalm 22:1-12", "시편 23:1", "시편 23" 형식 지원 (한 장 안의 범위)
  def parse(reference)
    ref = reference.to_s.dup.force_encoding('UTF-8').strip.gsub(/[–—~]/, '-')
    m = ref.match(/\A(.+?)\s*(\d+)(?::(\d+)(?:\s*-\s*(\d+))?)?\z/)
    raise ArgumentError, "장절 형식을 이해할 수 없습니다: #{reference}" unless m

    book = find_book(m[1]) or raise ArgumentError, "성경 이름을 찾을 수 없습니다: #{m[1]}"
    chapter = m[2]
    chapter_krv = krv.dig(book['id'], chapter) or raise ArgumentError, "#{book['ko']} #{chapter}장이 없습니다."
    last_verse = chapter_krv.keys.map(&:to_i).max
    from = m[3] ? m[3].to_i : 1
    to = m[4] ? m[4].to_i : (m[3] ? from : last_verse)
    raise ArgumentError, "절 범위가 올바르지 않습니다: #{reference}" if from < 1 || to < from || to > last_verse

    { book: book, chapter: chapter, from: from, to: to }
  end

  def labels(parsed)
    range = parsed[:from] == parsed[:to] ? parsed[:from].to_s : "#{parsed[:from]}–#{parsed[:to]}"
    range_en = parsed[:from] == parsed[:to] ? parsed[:from].to_s : "#{parsed[:from]}-#{parsed[:to]}"
    {
      ko: "#{parsed[:book]['ko']} #{parsed[:chapter]}:#{range}",
      en: "#{parsed[:book]['en']} #{parsed[:chapter]}:#{range_en}"
    }
  end

  def verses(parsed)
    id = parsed[:book]['id']
    ch = parsed[:chapter]
    (parsed[:from]..parsed[:to]).map do |n|
      {
        'num' => n,
        'text' => krv.dig(id, ch, n.to_s).to_s,
        'en' => bsb.dig(id, ch, n.to_s).to_s
      }
    end
  end

  def verse_ref(parsed, num)
    "#{parsed[:book]['ko']} #{parsed[:chapter]}:#{num}"
  end

  def normalize(text)
    text.to_s.gsub(/[[:space:]]+/, ' ').strip
  end
end
