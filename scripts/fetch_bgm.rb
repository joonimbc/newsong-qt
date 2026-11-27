#!/usr/bin/env ruby
# frozen_string_literal: true

# 퍼블릭 도메인 / CC0 클래식 피아노 BGM(.m4a) 자동 다운로드 & 경량 정규화 스크립트
#  - catalog.json 에 등록된 Wikimedia Commons 퍼블릭 도메인 연주를 1회 내려받아
#    48kbps 모노 AAC (.m4a, -20 LUFS 잔잔한 묵상 음량 정규화)로 저장합니다.
#  - 이미 생성된 .m4a 파일은 건너뛰어 재실행 시 0초에 끝납니다.

require 'json'
require 'net/http'
require 'uri'
require 'tempfile'
require 'fileutils'

ROOT_DIR = File.expand_path('..', __dir__)
BGM_DIR = File.join(ROOT_DIR, 'data', 'bgm')
CATALOG_PATH = File.join(BGM_DIR, 'catalog.json')
USER_AGENT = 'NewSongDailyQT/1.0 (https://www.new-song.org/; church devotional PWA)'

DEFAULT_CATALOG = {
  'version' => 1,
  'rotation' => 'weekly',
  'tracks' => [
    {
      'id' => 'bach-goldberg-aria',
      'title' => '바흐 · 골드베르크 변주곡 아리아',
      'composer' => 'J. S. Bach (BWV 988)',
      'performer' => 'Kimiko Ishizaka (Open Goldberg Variations)',
      'license' => 'CC0 1.0 Public Domain',
      'commonsFile' => 'Goldberg Variations 01 Aria.ogg',
      'file' => './data/bgm/bach-goldberg-aria.m4a'
    },
    {
      'id' => 'bach-prelude-c',
      'title' => '바흐 · 평균율 1번 C장조 전주곡',
      'composer' => 'J. S. Bach (BWV 846)',
      'performer' => 'Musopen',
      'license' => 'CC0 1.0 Public Domain',
      'commonsFile' => 'JS Bach - Well Tempered Clavier - Prelude in Fugue No.1 in C major.ogg',
      'file' => './data/bgm/bach-prelude-c.m4a'
    },
    {
      'id' => 'satie-gymnopedie-1',
      'title' => '사티 · 짐노페디 1번',
      'composer' => 'Erik Satie',
      'performer' => 'Wikimedia Commons',
      'license' => 'Public Domain',
      'commonsFile' => 'Erik Satie - gymnopedies - la 1 ere. lent et douloureux.ogg',
      'file' => './data/bgm/satie-gymnopedie-1.m4a'
    },
    {
      'id' => 'schumann-traumerei',
      'title' => '슈만 · 트로이메라이 (꿈)',
      'composer' => 'Robert Schumann (Op. 15 No. 7)',
      'performer' => 'Donald Betts (Musopen)',
      'license' => 'Public Domain',
      'commonsFile' => 'Robert Schumann - scenes from childhood, op. 15 - vii. dreaming.ogg',
      'file' => './data/bgm/schumann-traumerei.m4a'
    },
    {
      'id' => 'debussy-clair-de-lune',
      'title' => '드뷔시 · 달빛 (Clair de lune)',
      'composer' => 'Claude Debussy',
      'performer' => 'Laurens Goedhart',
      'license' => 'Public Domain / CC',
      'commonsFile' => 'Clair de lune (Claude Debussy) Suite bergamasque.ogg',
      'file' => './data/bgm/debussy-clair-de-lune.m4a'
    },
    {
      'id' => 'beethoven-moonlight-1',
      'title' => '베토벤 · 월광 소나타 1악장',
      'composer' => 'L. v. Beethoven (Op. 27 No. 2)',
      'performer' => 'Paul Pitman (Musopen)',
      'license' => 'Public Domain',
      'commonsFile' => "Ludwig van Beethoven - sonata no. 14 in c sharp minor 'moonlight', op. 27 no. 2 - i. adagio sostenuto.ogg",
      'file' => './data/bgm/beethoven-moonlight-1.m4a'
    },
    {
      'id' => 'bach-jesu-joy',
      'title' => '바흐 · 예수, 인간 소망의 기쁨',
      'composer' => 'J. S. Bach (BWV 147)',
      'performer' => 'Kevin MacLeod',
      'license' => 'CC BY 3.0',
      'commonsFile' => "Jesu, Joy of Man's Desiring2.ogg",
      'file' => './data/bgm/bach-jesu-joy.m4a'
    },
    {
      'id' => 'pachelbel-canon-piano',
      'title' => '파헬벨 · 캐논 피아노 독주',
      'composer' => 'Johann Pachelbel',
      'performer' => 'Lee Galloway',
      'license' => 'Public Domain / CC',
      'commonsFile' => "Pachelbel's Canon.ogg",
      'file' => './data/bgm/pachelbel-canon-piano.m4a'
    }
  ]
}.freeze

FileUtils.mkdir_p(BGM_DIR)
if !File.exist?(CATALOG_PATH)
  File.write(CATALOG_PATH, JSON.pretty_generate(DEFAULT_CATALOG) + "\n", encoding: 'UTF-8')
  puts '[BGM] 기본 catalog.json 생성 완료.'
else
  existing = JSON.parse(File.read(CATALOG_PATH, encoding: 'UTF-8'))
  existing_tracks = existing['tracks'] || []
  existing_ids = existing_tracks.map { |t| t['id'] }
  added = DEFAULT_CATALOG['tracks'].reject { |t| existing_ids.include?(t['id']) }
  unless added.empty?
    existing['tracks'] = existing_tracks + added
    File.write(CATALOG_PATH, JSON.pretty_generate(existing) + "\n", encoding: 'UTF-8')
    puts "[BGM] catalog.json 에 새 곡 #{added.size}곡 추가 완료."
  end
end

catalog = JSON.parse(File.read(CATALOG_PATH, encoding: 'UTF-8'))
tracks = catalog['tracks'] || []

def http_get_follow(url_str, limit = 5)
  raise '리다이렉트 횟수 초과' if limit <= 0

  uri = URI(url_str)
  req = Net::HTTP::Get.new(uri)
  req['User-Agent'] = USER_AGENT
  res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 20, read_timeout: 120) do |h|
    h.request(req)
  end

  if res.is_a?(Net::HTTPRedirection) && res['location']
    next_url = URI.join(uri, res['location']).to_s
    return http_get_follow(next_url, limit - 1)
  end

  raise "HTTP #{res.code} for #{url_str}" unless res.code == '200'

  res.body
end

def resolve_commons_url(file_name)
  encoded = URI.encode_www_form(
    action: 'query',
    titles: "File:#{file_name}",
    prop: 'imageinfo',
    iiprop: 'url',
    format: 'json'
  )
  body = http_get_follow("https://commons.wikimedia.org/w/api.php?#{encoded}")
  data = JSON.parse(body)
  pages = data.dig('query', 'pages') || {}
  page = pages.values.first || {}
  url = page.dig('imageinfo', 0, 'url').to_s.strip
  raise "Wikimedia Commons 파일을 찾을 수 없음: #{file_name}" if url.empty?

  url
end

def convert_to_bgm_m4a!(src_path, out_path)
  ok = system(
    'ffmpeg', '-nostdin', '-loglevel', 'error', '-y',
    '-i', src_path,
    '-af', 'loudnorm=I=-20:TP=-2:LRA=11',
    '-c:a', 'aac', '-b:a', '48k', '-ac', '1',
    '-movflags', '+faststart',
    out_path
  )
  raise 'ffmpeg 변환 실패' unless ok && File.exist?(out_path) && File.size(out_path) > 10_000
end

downloaded = 0
tracks.each do |t|
  id = t['id'].to_s.strip
  commons_file = t['commonsFile'].to_s.strip
  next if id.empty? || commons_file.empty?

  out_path = File.join(BGM_DIR, "#{id}.m4a")
  if File.exist?(out_path) && File.size(out_path) > 20_000
    puts "[BGM 건너뜀] #{File.basename(out_path)} — 이미 준비됨"
    next
  end

  begin
    puts "[BGM 다운로드] #{t['title']} (#{commons_file})"
    direct_url = resolve_commons_url(commons_file)
    raw = http_get_follow(direct_url)
    ext = File.extname(commons_file)
    ext = '.ogg' if ext.empty?

    Tempfile.create(['qt-bgm-', ext]) do |tmp|
      tmp.binmode
      tmp.write(raw)
      tmp.flush
      convert_to_bgm_m4a!(tmp.path, out_path)
    end

    kb = (File.size(out_path) / 1024.0).round
    puts "[BGM 완료] #{File.basename(out_path)} (#{kb}KB)"
    downloaded += 1
  rescue StandardError => e
    warn "[BGM 실패] #{id}: #{e.message}"
  end
end

puts "[BGM 종료] 새로 준비된 곡: #{downloaded}곡 (전체 목록 #{tracks.size}곡)"
