# frozen_string_literal: true

require 'json'

# 저작권 없는 개역한글판(1961) · BSB 데이터에서 장절로 본문을 찾아 주는 도우미
# 지원 형식:
#   - 한 장 범위: "시편 22:1–12", "시 22:22-31", "시편 21:1 - 21:13", "시편 23:1", "시편 23"
#   - 장을 넘는 범위: "고후 1:23-2:17", "사 52:13-53:12", "마 3:13-4:11", "히 2:10-3:1"
#   - 여러 장 통째로: "겔 40-42장", "창 1-3"
#   - 상/하반절 표기(a/b): "벧후 2:1-10a", "벧후 2:10b-22" (원문 절 단위로 수록하되 표기는 유지)
#   - 절기 괄호 메모: "마 28:1-10(부활절)", "눅 2:8-20(성탄절)"
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

  def max_verse(book, ch)
    ch_hash = krv.dig(book['id'], ch.to_s)
    raise ArgumentError, "#{book['ko']} #{ch}장이 없습니다." unless ch_hash

    ch_hash.keys.map(&:to_i).max
  end

  def parse(reference)
    raw = reference.to_s.dup.force_encoding('UTF-8').strip
    note = nil
    note = Regexp.last_match(1).strip if raw.sub!(/\s*\(([^)]+)\)\s*\z/, '')
    ref = raw.gsub(/[–—~]/, '-').sub(/(장|절)\s*\z/, '').strip

    bm = ref.match(/\A([1-3]?\s*[A-Za-z가-힣]+(?:\s+of\s+[A-Za-z]+)?)\s*(\d.*)\z/i)
    raise ArgumentError, "장절 형식을 이해할 수 없습니다: #{reference}" unless bm

    book = find_book(bm[1]) or raise ArgumentError, "성경 이름을 찾을 수 없습니다: #{bm[1]}"
    rest = bm[2].strip

    whole_chapters = false
    from_part = nil
    to_part = nil

    if (m = rest.match(/\A(\d+):(\d+)([ab])?\s*-\s*(\d+):(\d+)([ab])?\z/i))
      from_ch = m[1].to_i
      from_v = m[2].to_i
      from_part = m[3]&.downcase
      to_ch = m[4].to_i
      to_v = m[5].to_i
      to_part = m[6]&.downcase
    elsif (m = rest.match(/\A(\d+):(\d+)([ab])?(?:\s*-\s*(\d+)([ab])?)?\z/i))
      from_ch = to_ch = m[1].to_i
      from_v = m[2].to_i
      from_part = m[3]&.downcase
      to_v = m[4] ? m[4].to_i : from_v
      to_part = m[5]&.downcase
    elsif (m = rest.match(/\A(\d+)(?:\s*-\s*(\d+))?\z/))
      from_ch = m[1].to_i
      to_ch = (m[2] || m[1]).to_i
      whole_chapters = true
      from_v = 1
      to_v = max_verse(book, to_ch)
    else
      raise ArgumentError, "장절 범위를 이해할 수 없습니다: #{reference}"
    end

    raise ArgumentError, "장 범위가 올바르지 않습니다: #{reference}" if from_ch < 1 || to_ch < from_ch

    (from_ch..to_ch).each { |ch| max_verse(book, ch) }
    first_max = max_verse(book, from_ch)
    last_max = max_verse(book, to_ch)

    if from_ch == to_ch
      if from_v < 1 || to_v < from_v || to_v > first_max
        raise ArgumentError, "절 범위가 올바르지 않습니다: #{reference}"
      end
    elsif from_v < 1 || from_v > first_max || to_v < 1 || to_v > last_max
      raise ArgumentError, "절 범위가 올바르지 않습니다: #{reference}"
    end

    {
      book: book,
      chapter: from_ch.to_s,
      from: from_v,
      to: to_v,
      from_ch: from_ch,
      to_ch: to_ch,
      from_v: from_v,
      to_v: to_v,
      from_part: from_part,
      to_part: to_part,
      whole_chapters: whole_chapters,
      multi_chapter: from_ch != to_ch,
      note: note
    }
  end

  def labels(parsed)
    book = parsed[:book]
    f_v = "#{parsed[:from_v]}#{parsed[:from_part]}"
    t_v = "#{parsed[:to_v]}#{parsed[:to_part]}"

    if parsed[:whole_chapters]
      if parsed[:multi_chapter]
        ko = "#{book['ko']} #{parsed[:from_ch]}–#{parsed[:to_ch]}장"
        en = "#{book['en']} #{parsed[:from_ch]}-#{parsed[:to_ch]}"
      else
        ko = "#{book['ko']} #{parsed[:from_ch]}:1–#{parsed[:to_v]}"
        en = "#{book['en']} #{parsed[:from_ch]}:1-#{parsed[:to_v]}"
      end
    elsif parsed[:multi_chapter]
      ko = "#{book['ko']} #{parsed[:from_ch]}:#{f_v}–#{parsed[:to_ch]}:#{t_v}"
      en = "#{book['en']} #{parsed[:from_ch]}:#{f_v}-#{parsed[:to_ch]}:#{t_v}"
    else
      same_v = (f_v == t_v)
      ko = "#{book['ko']} #{parsed[:from_ch]}:#{same_v ? f_v : "#{f_v}–#{t_v}"}"
      en = "#{book['en']} #{parsed[:from_ch]}:#{same_v ? f_v : "#{f_v}-#{t_v}"}"
    end

    { ko: ko, en: en }
  end

  def verses(parsed)
    id = parsed[:book]['id']
    multi = parsed[:multi_chapter]
    list = []

    (parsed[:from_ch]..parsed[:to_ch]).each do |ch|
      ch_s = ch.to_s
      v_start = ch == parsed[:from_ch] ? parsed[:from_v] : 1
      v_end = ch == parsed[:to_ch] ? parsed[:to_v] : max_verse(parsed[:book], ch)
      (v_start..v_end).each do |n|
        ko_text = krv.dig(id, ch_s, n.to_s).to_s
        en_text = bsb.dig(id, ch_s, n.to_s).to_s
        if en_text.strip.empty?
          en_text = ko_text.strip == '(없음)' ? '(Omitted in earliest manuscripts)' : '(Verse numbering differs or omitted in BSB)'
        end
        list << {
          'num' => multi ? "#{ch}:#{n}" : n,
          'text' => ko_text,
          'en' => en_text
        }
      end
    end

    list
  end

  def verse_ref(parsed, num)
    num_s = num.to_s
    if num_s.include?(':')
      "#{parsed[:book]['ko']} #{num_s}"
    else
      "#{parsed[:book]['ko']} #{parsed[:from_ch]}:#{num_s}"
    end
  end

  def normalize(text)
    text.to_s.gsub(/[[:space:]]+/, ' ').strip
  end
end
