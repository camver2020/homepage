"""IMAGE 자리(.lbl aria-label 로 찾음)에 실제 사진을 넣는다. 한 번 넣은 자리는 다시 안 건드림."""
import re, sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent

# (aria-label, 이미지, alt, 사진 위 글자가 없으면 True → 어둡게 깔지 않음, object-position)
MAP = {
 'src/pages/index.html': [
  ('사진 자리: Fleet AI OS', 'fleet-garage', '주차장에 나란히 선 캠버 운영 차량들', False, 'center 60%'),
  ('사진 자리: 이동형 안전 쉼터', 'shelter-site', '캠핑카 차양 아래에서 쉬는 사람들', False, 'center'),
  ('사진 자리: 기업 복지 휴양소', 'resort-seaside', '바닷가에 세운 휴양 차량과 여행객', False, 'center'),
  ('사진 자리: 특장차 제작·개조', 'station-sign', '캠버 스마트 스테이션 안에 세운 차량들', False, 'center'),
  ('사진 자리: 캠핑·레저', 'camping-night', '조명을 켠 캠핑카와 야외 의자', False, 'center'),
  ('사진 자리: 캠버 사람들과 현장', 'team', '캠버 팀원들', True, 'center 30%'),
  ('사진 자리: 휴양 차량', 'camper-sunset', '노을 아래 세운 캠버 캠핑카', False, 'center'),
  ('사진 자리: 쉼터 차량', 'shelter-site', '캠핑카 차양 아래에서 쉬는 사람들', False, '30% center'),
  ('사진 자리: 특수목적 차량', 'ambulance', '구급차', False, 'center'),
  ('사진 자리: 캠핑카 여행', 'camper-beach', '바닷가에 세운 캠핑카와 여행객', False, 'center'),
  ('사진 자리: 차량 개조 작업', 'workshop', '정비동 안의 캠버 차량들', False, 'center'),
  ('사진 자리: 차량 출고', 'station-lounge', '스마트 스테이션 안 대기 공간과 차량', False, 'center'),
  ('사진 자리: 스마트 스테이션', 'station-front', '캠버 스마트 스테이션 건물과 주차된 차량', False, 'center'),
 ],
 'src/partials/join.html': [
  ('사진 자리: 함께 일하는 모습', 'presentation', '캠버 발표 현장', False, 'center 35%'),
 ],
 'src/pages/company.html': [
  ('사진 자리: 캠버 사람들', 'station-black', '캠버 스마트 스테이션 건물', False, 'center 40%'),
  ('사진 자리: 벤처기업 확인서', 'cert-venture', '벤처기업 확인서', True, ''),
  ('사진 자리: 기업부설연구소 인정서', 'cert-lab', '기업부설연구소 인정서', True, ''),
  ('사진 자리: 국토교통부 장관상 상장', 'award-molit', '국토교통부 장관상 상장', True, ''),
  ('사진 자리: 특허증', 'patent-1', '특허증', True, ''),
  ('사진 자리: 특허증', 'patent-2', '특허증', True, ''),
  ('사진 자리: 특허증', 'patent-3', '특허증', True, ''),
 ],
 'src/pages/business.html': [
  ('사진 자리: 휴양 차량과 쉼터 차량', 'resort-seaside', '바닷가에 세운 휴양 차량과 여행객', False, 'center'),
  ('사진 자리: 임직원 휴양 차량', 'camper-interior', '휴양 차량 실내 침상과 랜턴', True, 'center'),
  ('사진 자리: 현장 쉼터 차량', 'shelter-site', '캠핑카 차양 아래에서 쉬는 사람들', True, '35% center'),
  ('사진 자리: 관제 장비를 단 특수목적 차량', 'ambulance', '구급차', True, 'center 60%'),
  ('사진 자리: 현대자동차 캠핑카', 'hyundai-campers', '나란히 주차된 현대자동차 캠핑카들', False, 'center 60%'),
  ('사진 자리: 펫문 이동형 화장차', 'petmun', '펫문 이동형 화장차', False, 'center 60%'),
  ('사진 자리: 성우모터스 구급차', 'ambulance', '성우모터스 구급차', False, 'center 60%'),
  ('사진 자리: 캠핑카 여행', 'camping-night', '조명을 켠 캠핑카와 야외 의자', True, 'center'),
 ],
 'src/pages/service.html': [
  ('사진 자리: 차량 개조 작업', 'workshop', '정비동 안의 캠버 차량들', False, 'center'),
  ('사진 자리: 차량 개조 작업 현장', 'interior-care', '차량 실내를 정비하는 직원', True, 'center'),
  ('사진 자리: 스마트홈 캠핑카', 'camper-beach', '스마트홈 캠핑카', False, 'center 40%'),
  ('사진 자리: 레이 캠핑카', 'ray-camper', '레이 캠핑카', False, 'center'),
  ('사진 자리: 차량 출고·인수', 'station-lounge', '스마트 스테이션 안 대기 공간과 차량', True, 'center'),
  ('사진 자리: 스마트 스테이션', 'station-red', '캠버 스마트 스테이션 건물', True, 'center'),
 ],
 'src/pages/solution.html': [
  ('사진 자리: Fleet AI OS 관제 화면', 'fleet-garage', '주차장에 나란히 선 캠버 운영 차량들', False, 'center 60%'),
  ('사진 자리: 기업 복지 차량', 'camper-interior', '휴양 차량 실내', False, 'center'),
  ('사진 자리: 공공·산업 현장 차량', 'ambulance', '구급차', False, 'center 60%'),
  ('사진 자리: 레저 차량', 'ray-camper', '레이 캠핑카', False, 'center'),
  ('사진 자리: 스마트 스테이션', 'station-front', '캠버 스마트 스테이션 건물과 주차된 차량', False, 'center'),
 ],
 'src/pages/cs.html': [
  ('사진 자리: 차량 인수 안내', 'station-sign', '캠버 스마트 스테이션 안에 세운 차량들', False, 'center'),
 ],
}

def place(path, items):
    s = (ROOT / path).read_text(encoding='utf-8')
    for label, img, alt, plain, pos in items:
        pat = re.compile(r'(<(?:div|a|section|article)\b[^>]*class="([^"]*\bphoto\b[^"]*)"[^>]*>)(\s*)<span class="ph-frame" aria-hidden="true"></span>\s*<div class="lbl[^"]*" role="img" aria-label="' + re.escape(label) + r'">.*?</div>', re.S)
        m = pat.search(s)
        if not m:
            print('  skip (없거나 이미 채움):', path, label); continue
        open_tag, cls, ws = m.group(1), m.group(2), m.group(3)
        if plain and 'plain' not in cls.split():
            open_tag = open_tag.replace('class="' + cls + '"', 'class="' + cls + ' plain"', 1)
        style = f' style="object-position: {pos}"' if pos and pos != 'center' else ''
        tag = f'<img src="img/{img}.jpg" alt="{alt}" loading="lazy" decoding="async"{style}>'
        s = s[:m.start()] + open_tag + ws + tag + s[m.end():]
        print('  ok', label, '→', img)
    (ROOT / path).write_text(s, encoding='utf-8')

for p, items in MAP.items():
    print(p); place(p, items)
