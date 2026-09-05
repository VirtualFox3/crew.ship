"""Generate Crew.Ship's application icon from a fixed pixel grid.

No image model or downloaded artwork is involved. The 32×32 master is drawn
from named palette values and rectangles, then scaled with nearest-neighbour
sampling so it remains sharp at every Windows icon size.
"""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
PIXEL = 32
PALETTE = {
    "void": "#202226",
    "edge": "#121316",
    "white": "#f2f4f7",
    "blue": "#2d61dc",
    "blue_light": "#82a6ff",
    "red": "#dc5367",
    "mast": "#cfd5df",
}


def rect(draw: ImageDraw.ImageDraw, color: str, *box: int) -> None:
    draw.rectangle(box, fill=PALETTE[color])


def master() -> Image.Image:
    image = Image.new("RGBA", (PIXEL, PIXEL), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    # Three flat colors. Even grid steps remain legible at 16px.
    # A blue stepped hull, white sail/mast, and a single coral pennant.
    draw.rectangle((14, 4, 15, 21), fill="#f4f4f4")
    draw.rectangle((16, 4, 23, 7), fill="#df596a")
    draw.rectangle((10, 10, 11, 13), fill="#f4f4f4")
    draw.rectangle((8, 14, 11, 17), fill="#f4f4f4")
    draw.rectangle((6, 18, 11, 19), fill="#f4f4f4")
    draw.rectangle((18, 10, 19, 13), fill="#f4f4f4")
    draw.rectangle((18, 14, 21, 17), fill="#f4f4f4")
    draw.rectangle((18, 18, 23, 19), fill="#f4f4f4")
    draw.rectangle((4, 22, 27, 23), fill="#5d91f4")
    draw.rectangle((6, 24, 25, 25), fill="#5d91f4")
    draw.rectangle((8, 26, 23, 27), fill="#5d91f4")
    return image


def write_icon(image: Image.Image, filename: str, size: int) -> None:
    image.resize((size, size), Image.Resampling.NEAREST).save(ROOT / filename, "PNG", optimize=True)


def main() -> None:
    image = master()
    for filename, size in [
        ("icon.png", 512), ("128x128.png", 128), ("128x128@2x.png", 256),
        ("64x64.png", 64), ("32x32.png", 32), ("Square310x310Logo.png", 310),
        ("Square284x284Logo.png", 284), ("Square150x150Logo.png", 150),
        ("Square142x142Logo.png", 142), ("Square107x107Logo.png", 107),
        ("Square89x89Logo.png", 89), ("Square71x71Logo.png", 71),
        ("Square44x44Logo.png", 44), ("Square30x30Logo.png", 30),
        ("StoreLogo.png", 50),
    ]:
        write_icon(image, filename, size)
    large = image.resize((1024, 1024), Image.Resampling.NEAREST)
    large.save(ROOT / "icon.ico", format="ICO", sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
    large.save(ROOT / "icon.icns", format="ICNS")
    # Export the same pixel drawing as resolution-independent SVG.
    pixels = []
    for y in range(32):
        for x in range(32):
            r,g,b,a = image.getpixel((x,y))
            if a:
                pixels.append(f'<path fill="#{r:02x}{g:02x}{b:02x}" d="M{x} {y}h1v1h-1z"/>')
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" shape-rendering="crispEdges">' + ''.join(pixels) + '</svg>'
    glyphs = {
        'C':['11111','11000','11000','11000','11000','11000','11111'],
        'R':['11110','11011','11011','11110','11100','11010','11011'],
        'E':['11111','11000','11000','11110','11000','11000','11111'],
        'W':['11011','11011','11011','11011','11111','11111','01010'],
        '.':['00','00','00','00','00','11','11'],
        'S':['11111','11000','11000','11111','00011','00011','11111'],
        'H':['11011','11011','11011','11111','11011','11011','11011'],
        'I':['111','010','010','010','010','010','111'],
        'P':['11110','11011','11011','11110','11000','11000','11000'],
    }
    blocks = []; offset = 1
    for letter in 'CREW.SHIP':
        for y,row in enumerate(glyphs[letter]):
            for x,cell in enumerate(row):
                if cell == '1': blocks.append(f'M{offset+x} {y+1}h1v1h-1z')
        offset += len(glyphs[letter][0]) + 1
    path = ''.join(blocks)
    wordmark = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {offset+2} 12"><path d="{path}" fill="#080b10" stroke="#080b10" stroke-width=".8" transform="translate(1 3)"/><path d="{path}" fill="#6d7e94" transform="translate(.5 1.5)"/><path d="{path}" fill="#f8f5ed"/></svg>'
    repo = ROOT.parents[2]
    for folder in [repo / 'public' / 'brand', repo / 'desktop' / 'public' / 'brand']:
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'ship.svg').write_text(svg, encoding='utf-8')
        (folder / 'wordmark.svg').write_text(wordmark, encoding='utf-8')
        large.save(folder / 'ship.png')
    (repo / 'public' / 'favicon.ico').write_bytes((ROOT / 'icon.ico').read_bytes())


if __name__ == "__main__":
    main()
