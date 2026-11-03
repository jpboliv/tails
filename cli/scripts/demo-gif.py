"""Encode demo.mjs screenshots with short captions. Requires Pillow.

Usage: python demo-gif.py <capture-folder> <output.gif>
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

source, output = map(Path, sys.argv[1:3])
frames = json.loads((source / "frames.json").read_text())
font = ImageFont.load_default(size=18)
small = ImageFont.load_default(size=12)
images = []
for frame in frames:
    screenshot = Image.open(source / frame["file"]).convert("RGB")
    screenshot.thumbnail((1080, 720), Image.Resampling.LANCZOS)
    image = Image.new("RGB", (1080, 790), "#fcfcfd")
    image.paste(screenshot, (0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 720, 1080, 790), fill="#18191d")
    draw.rectangle((0, 720, 5, 790), fill="#ef9b28")
    draw.text((24, 737), frame["caption"], font=font, fill="#ffffff")
    draw.text((24, 766), "TAILS / FEATURE FLAGS / SAMPLE SPECS", font=small, fill="#b4b8c1")
    images.append(image.quantize(colors=256, method=Image.Quantize.MAXCOVERAGE))
output.parent.mkdir(parents=True, exist_ok=True)
images[0].save(output, save_all=True, append_images=images[1:], duration=[f["duration"] for f in frames], loop=0, optimize=True, disposal=2)
print(f"{output}: {len(images)} frames, {output.stat().st_size:,} bytes")
