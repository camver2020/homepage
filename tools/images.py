"""옛 camver.co.kr 에서 받은 이미지(assets-src/old)를 사이트용으로 줄이고 이름 붙여 src/img 에 저장."""
import glob, os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OLD = os.path.join(ROOT, 'assets-src', 'old')
OUT = os.path.join(ROOT, 'src', 'img')

def src(prefix):
    m = sorted(glob.glob(os.path.join(OLD, prefix.split('_')[0], prefix + '*')))
    if not m: sys.exit('missing ' + prefix)
    return m[0]

PHOTOS = {  # 출력 이름: (원본, 최대 가로 px)
    'fleet-garage': ('vehicle_007', 1600), 'shelter-site': ('vehicle_010', 2000), 'resort-seaside': ('vehicle_012', 2000),
    'station-sign': ('vehicle_004', 1600), 'camping-night': ('vehicle_031', 1600), 'team': ('people_001', 1600),
    'camper-sunset': ('vehicle_028', 900), 'ambulance': ('vehicle_024', 900), 'camper-beach': ('vehicle_029', 900),
    'workshop': ('vehicle_008', 1600), 'station-lounge': ('vehicle_005', 1600), 'station-front': ('vehicle_001', 1600),
    'station-black': ('vehicle_002', 1600), 'station-red': ('vehicle_003', 1600), 'camper-interior': ('vehicle_019', 1280),
    'hyundai-campers': ('vehicle_023', 900), 'petmun': ('vehicle_021', 900), 'interior-care': ('vehicle_026', 900),
    'ray-camper': ('vehicle_016', 1280), 'presentation': ('people_004', 1600),
    'cert-venture': ('cert_002', 600), 'cert-lab': ('cert_011', 600), 'cert-tech': ('cert_009', 600),
    'award-molit': ('cert_010', 600), 'award-kto': ('cert_004', 600),
    'patent-1': ('cert_003', 600), 'patent-2': ('cert_008', 600), 'patent-3': ('cert_013', 600),
}
PARTNERS = {
    'hyundai': 'partner_036', 'hec': 'partner_028', 'snuh-bundang': 'partner_002', 'kepco': 'partner_024', 'kdn': 'partner_013',
    'kdic': 'partner_012', 'nps': 'partner_011', 'kt': 'partner_020', 'sungwoo': 'partner_032', 'focus': 'partner_014',
    'ezwel': 'partner_039', 'plusand': 'partner_029', 'homeplus': 'partner_031', 'homeshopping': 'partner_006',
    'sequencen': 'partner_052', 'wadiz': 'partner_025', 'kakaotalk': 'partner_048', 'molit': 'partner_026', 'kto': 'partner_019',
    'kibo': 'partner_038', 'kodit': 'partner_043', 'kosme': 'partner_021', 'ccei-jeju': 'partner_017', 'smartcity': 'partner_037',
    'campground': 'partner_018',
}

def trim_white_bottom(im):
    """옛 사이트 썸네일(400x480) 아래에 붙어 있는 흰 여백 띠를 잘라낸다. 사진 위에 어두운 막을 깔면 회색 띠로 보임"""
    from PIL import ImageStat
    w, h = im.size
    n = 0
    while n < h // 6:
        st = ImageStat.Stat(im.crop((0, h - 1 - n, w, h - n)))
        if sum(st.mean) / 3 > 235 and sum(st.stddev) / 3 < 12:
            n += 1
        else:
            break
    return im.crop((0, 0, w, h - n - 2)) if n >= 4 else im

def save_jpg(im, path, maxw, q=82):
    im = trim_white_bottom(im.convert('RGB'))
    if im.width > maxw:
        im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
    im.save(path, 'JPEG', quality=q, optimize=True, progressive=True)
    return im.size

for name, (p, w) in PHOTOS.items():
    size = save_jpg(Image.open(src(p)), os.path.join(OUT, name + '.jpg'), w)
    print(name, size)
for name, p in PARTNERS.items():
    im = Image.open(src(p)).convert('RGBA'); bg = Image.new('RGBA', im.size, (255, 255, 255, 255)); bg.alpha_composite(im)
    save_jpg(bg, os.path.join(OUT, 'partners', name + '.jpg'), 250, 88)
logo = Image.open(src('logo_001')).convert('RGBA'); logo = logo.crop(logo.getbbox()); logo.save(os.path.join(OUT, 'camver-logo.png'), optimize=True)
print('logo', logo.size)
