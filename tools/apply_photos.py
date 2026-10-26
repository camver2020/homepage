"""홈페이지 이미지 폴더(칸 번호 이름) → src/img/slots/*.jpg 변환 + 페이지의 data-slot 자리 교체.
python3 tools/apply_photos.py "<폴더>"
"""
import json, pathlib, re, shutil, sys
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
OUT = SRC / 'img' / 'slots'
IN = pathlib.Path(sys.argv[1])

# 칸 → (원본 파일, 대체 텍스트). 파일 이름과 내용이 다른 칸은 내용 기준으로 옮김
MAP = {
    'home-04': ('home/home-04.png', '차량 공장에서 태블릿을 함께 보는 직원 두 명'),
    'home-05': ('home/home-05.png', '캠핑장 풍경 위에 띄운 VANPICK 앱 화면'),
    'home-06': ('home/home-06.png', '산길 도로를 달리는 셔틀과 화물차'),
    'home-11': ('home/home-11.png', '정비동 리프트에 올려 개조 중인 승합차'),
    'join-01': ('home/join-01.png', '숲 사이로 굽어진 도로'),
    'company-01': ('company/company-01.png', '어두운 배경의 AX 그래픽'),
    'company-02': ('company/company-02.png', '행사 무대에서 발표하는 캠버 대표'),
    'company-03': ('company/company-03.png', 'KTCC 시험성적서'),
    'company-04': ('company/company-04.png', 'KGcT 시험성적서'),
    'company-05': ('company/company-05.png', '실증을 위한 규제특례 확인서'),
    'company-06': ('company/company-06.png', '위치기반서비스사업 신고확인증'),
    'company-07': ('company/company-07.png', '벤처기업 확인서'),
    'company-08': ('company/company-08.png', '기업부설연구소 인정서'),
    'company-09': ('company/company-09.png', 'Open NEST 200 기업 선정서'),
    'company-10': ('company/company-10.png', '국토교통부 장관상 상장'),
    'company-11': ('company/company-11.png', '기아 PBV 아이디어 공모전 우수상 상장'),
    'company-12': ('company/company-12.png', '위치정보 우수 비즈니스 모델 발굴 공모전 우수상 상장'),
    'company-12-02': ('company/company-12-02.png', '한국관광공사 장려상 상장'),
    'company-13': ('company/company-13.png', '특허증'),
    'company-14': ('company/company-14.png', '특허증'),
    'company-15': ('company/company-15.png', '특허증'),
    'company-16': ('company/company-16.png', 'camver 로고 상표등록증'),
    'company-17': ('company/company-17.png', 'CAMVER 상표등록증'),
    'company-map': ('company_map/map.png', '캠버 본사 위치 지도: 서울 서초구 청계산로9길 70, 청계산입구역 근처'),
    'cs-01': ('cs/cs-01.png', '고속도로를 달리는 화물차와 승합차'),
    'business-02': ('business/business-02.png', '노을 진 바닷가에서 차량 뒤에 앉아 쉬는 사람들'),
    'business-03': ('business/business-03.png', '노을 진 바닷가에서 차량 옆에 앉아 쉬는 사람들'),
    'business-04': ('business/business-04.png', '포레스트 캠핑카 외관'),
    'business-05': ('business/business-05.png', '스타리아 캠핑카 외관'),
    'business-06': ('business/business-06.png', 'PV5 캠핑카와 야외 테이블'),
    'business-07': ('business/business-07.png', '현장 쉼터 차량, 구급차, 화물차'),
    'business-08': ('business/business-08.png', '창고에 나란히 세운 현대자동차 캠핑카들'),
    'business-09': ('business/business-09.png', '주차장에 줄지어 세운 현대엔지니어링 캠핑카들'),
    'business-12': ('business/business-12.png', '해 질 녘 캠핑장의 VANPICK 캠핑카'),
    'service-01': ('service/service-01.png', '캠핑장 풍경 위에 띄운 VANPICK 앱 화면'),
    'service-02': ('service/service-02.png', '공장에서 PV5 실내를 개조하는 작업자들'),
    'service-03': ('service/service-03.png', '스마트홈 캠핑카 외관'),
    'service-04': ('service/service-04.png', '스타리아 캠핑카 외관'),
    'service-06': ('service/service-05.png', '캠핑카들 앞에서 태블릿으로 차량을 확인하는 직원'),
    'solution-03': ('solution/solution-03.png', '캠핑카 앞에서 쉬는 가족'),
    'solution-04': ('solution/solution-04.png', '환경관리 이동지원 차량과 작업자'),
    'solution-05': ('solution/solution-05.png', '산 아래 캠핑장에 세운 캠핑카들'),
    'solution-06': ('solution/solution-06.png', '찾아가는 의료서비스 차량'),
    'solution-07': ('solution/solution-08.png', '실내 스테이션에 세운 캠핑카들'),
    'solution-08': ('solution/solution-07.png', '지도 위 차량 위치를 보여주는 관제 화면'),
}
PLAIN = {'company-02'}  # 글씨가 안 올라가는 사진: 어두운 막 없이

def convert():
    OUT.mkdir(parents=True, exist_ok=True)
    for slot, (src, _) in MAP.items():
        im = Image.open(IN / src).convert('RGB')
        q = 90 if im.width < 300 else 85
        im.save(OUT / f'{slot}.jpg', 'JPEG', quality=q, optimize=True, progressive=True)
    logo = IN / 'home/logo.png'
    if logo.exists():
        old = SRC / 'img/camver-logo.png'
        bak = ROOT / 'assets-src/camver-logo-old.png'
        if not bak.exists(): bak.parent.mkdir(exist_ok=True); shutil.copy(old, bak)
        shutil.copy(logo, old)

def patch(text, slot, alt):
    src = f'img/slots/{slot}.jpg'
    # 1) 이미 사진이 있는 칸: src·alt 교체, 예전 사진용 위치 보정 제거
    pat = re.compile(r'<img data-slot="%s" src="[^"]*" alt="[^"]*"([^>]*)>' % re.escape(slot))
    if pat.search(text):
        def rep(m):
            rest = re.sub(r'\s*style="object-position:[^"]*"', '', m.group(1))
            return f'<img data-slot="{slot}" src="{src}" alt="{alt}"{rest}>'
        return pat.sub(rep, text, count=1), 'img'
    # 2) 빈 칸: 점선 틀 + 안내 글 → 사진
    pat = re.compile(r'<span class="ph-frame" aria-hidden="true"></span>\s*<div data-slot="%s" class="lbl[^"]*"[^>]*>.*?</div>' % re.escape(slot), re.S)
    if pat.search(text):
        return pat.sub(f'<img data-slot="{slot}" src="{src}" alt="{alt}" loading="lazy" decoding="async">', text, count=1), 'placeholder'
    return text, None

def main():
    convert()
    pages = list((SRC / 'pages').glob('*.html')) + [SRC / 'partials/join.html']
    done = {}
    for p in pages:
        t = p.read_text()
        for slot, (_, alt) in MAP.items():
            if slot == 'company-map': continue
            t, how = patch(t, slot, alt)
            if how: done[slot] = (p.name, how)
        p.write_text(t)
    missing = [s for s in MAP if s not in done and s not in ('company-map', 'company-12-02')]
    print('patched', len(done), 'missing', missing)

if __name__ == '__main__':
    main()
