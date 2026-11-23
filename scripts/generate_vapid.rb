#!/usr/bin/env ruby
# frozen_string_literal: true

# Web Push VAPID 키(P-256) 생성 스크립트
# - 외부 패키지 없이 Ruby 표준 OpenSSL로 생성합니다.
# - 생성된 공개 키(VAPID_PUBLIC_KEY)는 data/schedule.json 과 Cloudflare Worker 환경변수에 넣고,
#   비밀 키(VAPID_PRIVATE_JWK)는 Cloudflare Worker Secret 에만 안전하게 보관하세요.

require 'openssl'
require 'base64'
require 'json'

def b64url(bytes)
  Base64.urlsafe_encode64(bytes, padding: false)
end

ec = OpenSSL::PKey::EC.generate('prime256v1')
pub_hex = ec.public_key.to_bn.to_s(16).rjust(130, '0')
pub_bytes = [pub_hex].pack('H*') # 0x04 || X(32) || Y(32)
raise "Unexpected uncompressed EC point length: #{pub_bytes.bytesize}" unless pub_bytes.bytesize == 65

priv_hex = ec.private_key.to_s(16).rjust(64, '0')
priv_bytes = [priv_hex].pack('H*')

x_bytes = pub_bytes[1, 32]
y_bytes = pub_bytes[33, 32]

jwk = {
  'kty' => 'EC',
  'crv' => 'P-256',
  'x' => b64url(x_bytes),
  'y' => b64url(y_bytes),
  'd' => b64url(priv_bytes),
  'ext' => true
}

puts '=== Web Push VAPID Keys Generated ==='
puts ''
puts '1) VAPID_PUBLIC_KEY (data/schedule.json 및 Cloudflare Worker 변수에 입력):'
puts b64url(pub_bytes)
puts ''
puts '2) VAPID_PRIVATE_JWK (Cloudflare Worker Secret에만 입력, GitHub에 올리지 마세요!):'
puts JSON.generate(jwk)
