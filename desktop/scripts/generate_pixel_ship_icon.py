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
    image = Image.new("RGBA", (PIXEL, PIXEL), PALETTE["void"])
    draw = ImageDraw.Draw(image)
    # Pixel frame
    rect(draw, "edge", 1, 1, 30, 2); rect(draw, "edge", 1, 29, 30, 30)
    rect(draw, "edge", 1, 1, 2, 30); rect(draw, "edge", 29, 1, 30, 30)
    # Water, a hard horizon that keeps the silhouette readable at 32px.
    rect(draw, "blue", 6, 26, 25, 27); rect(draw, "blue_light", 10, 28, 21, 28)
    # Hull: three stepped rows, bow and stern deliberately squared.
    rect(draw, "edge", 6, 20, 25, 21); rect(draw, "edge", 7, 22, 24, 23)
    rect(draw, "edge", 9, 24, 22, 24)
    rect(draw, "white", 8, 20, 23, 20); rect(draw, "white", 9, 21, 22, 21)
    rect(draw, "white", 10, 22, 21, 22)
    # Mast, boom, and two block sails.
    rect(draw, "mast", 15, 5, 16, 20); rect(draw, "mast", 8, 9, 23, 10)
    rect(draw, "blue", 8, 11, 14, 17); rect(draw, "blue", 9, 18, 14, 18)
    rect(draw, "blue_light", 9, 12, 11, 13)
    rect(draw, "red", 17, 8, 22, 15); rect(draw, "red", 17, 16, 24, 17)
    rect(draw, "red", 17, 5, 20, 7)  # pennant
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
    image.save(ROOT / "icon.ico", format="ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    image.save(ROOT / "icon.icns", format="ICNS")


if __name__ == "__main__":
    main()
