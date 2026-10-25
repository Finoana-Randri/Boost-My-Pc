# Generate every icon derived from assets/icon.png: tray icon, Windows .ico,
# README logo, and the installer side banners.
# Run after changing assets/icon.png: python scripts/make-icons.py  (requires Pillow)
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets', 'icon.png')


def load_clean():
    im = Image.open(SRC).convert('RGBA')
    px = im.load()
    w, h = im.size
    # Remove dark, semi-transparent specks left around the glow by the background removal.
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a and a < 250 and r + g + b < 180:
                px[x, y] = (0, 0, 0, 0)
    # Crop to the visible shape, as a square, so small sizes use all their pixels.
    l, t, r, b = im.getchannel('A').point(lambda v: 255 if v > 40 else 0).getbbox()
    side = max(r - l, b - t)
    cx, cy = (l + r) // 2, (t + b) // 2
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(im.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)), (0, 0))
    return square


def sized(im, size, margin=0.0):
    inner = round(size * (1 - 2 * margin))
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    small = im.resize((inner, inner), Image.LANCZOS)
    if size <= 32:
        small = small.filter(ImageFilter.UnsharpMask(radius=0.6, percent=60, threshold=1))
    out.paste(small, ((size - inner) // 2, (size - inner) // 2), small)
    return out


def font(names, size):
    for n in names:
        for d in ('C:/Windows/Fonts', '/usr/share/fonts/truetype/dejavu'):
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def sidebar(icon, path):
    # NSIS wizard banner: 164 x 314, drawn at 3x then reduced for smooth edges.
    k = 3
    W, H = 164 * k, 314 * k
    bg = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(bg)
    top, bottom = (58, 18, 112), (196, 40, 168)
    for y in range(H):
        t = y / (H - 1)
        d.line([(0, y), (W, y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([W * 0.05, H * 0.08, W * 0.95, H * 0.45], fill=(255, 120, 230, 90))
    bg = Image.alpha_composite(bg.convert('RGBA'), glow.filter(ImageFilter.GaussianBlur(40 * k / 3)))
    ic = sized(icon, 104 * k)
    bg.alpha_composite(ic, ((W - ic.width) // 2, 52 * k))
    d = ImageDraw.Draw(bg)
    title = font(['segoeuib.ttf', 'DejaVuSans-Bold.ttf'], 19 * k)
    sub = font(['segoeui.ttf', 'DejaVuSans.ttf'], 10 * k)
    def center(text, y, f, fill):
        w = d.textbbox((0, 0), text, font=f)[2]
        d.text(((W - w) / 2, y), text, font=f, fill=fill)
    center('Boost My Pc', 172 * k, title, (255, 255, 255))
    center('Nettoyez, protégez et', 202 * k, sub, (255, 255, 255, 215))
    center('accélérez votre PC', 216 * k, sub, (255, 255, 255, 215))
    bg.convert('RGB').resize((164, 314), Image.LANCZOS).save(path)


def main():
    icon = load_clean()
    # Tray: full bleed so the shape stays readable at 16 px; 64 px source, reduced by the app.
    sized(icon, 64).save(os.path.join(ROOT, 'assets', 'tray.png'))
    # Windows icon with the usual sizes (taskbar, Start menu, Explorer, installer).
    sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    frames = [sized(icon, s, 0.02 if s >= 48 else 0) for s in sizes]
    frames[-1].save(os.path.join(ROOT, 'build', 'icon.ico'), format='ICO', sizes=[(s, s) for s in sizes], append_images=frames[:-1])
    sized(icon, 512, 0.03).save(os.path.join(ROOT, 'docs', 'logo.png'))
    # Light copy for the interface (title bar, welcome, About): the source is large.
    sized(icon, 256).save(os.path.join(ROOT, 'assets', 'icon-256.png'), optimize=True)
    for name in ('installerSidebar.bmp', 'uninstallerSidebar.bmp'):
        sidebar(icon, os.path.join(ROOT, 'build', name))
    print('ok: assets/tray.png, assets/icon-256.png, build/icon.ico, docs/logo.png, build/*Sidebar.bmp')


if __name__ == '__main__':
    main()
