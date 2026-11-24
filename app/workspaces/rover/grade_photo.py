#!/usr/bin/env python3
"""Grade the rover photograph for the dark studio. Needs Pillow and numpy.

Reads  assets/img/landing/rover-real.jpg (never written)
Writes assets/img/landing/rover-real-graded.webp (colour and alpha, same 1060 x 596 pixels)

Every output pixel is the same input pixel times a gain and a slight tint. Nothing is painted, moved or added: a hand-drawn
mask decides which pixels are rover and which are floor. Floor goes to near black outside a pool of light.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'assets', 'img', 'landing'))
src = np.asarray(Image.open(os.path.join(ROOT, 'rover-real.jpg')).convert('RGB')).astype(np.float32) / 255
H, W = src.shape[:2]
S = 4  # masks are drawn at four times the size, then reduced

# hand-traced outlines, photo pixels
SOLID = [
    # mast
    [(482.5, 83), (498, 77), (528, 70), (553, 67), (580, 66), (640, 65), (663, 64), (664, 100), (667, 143), (671, 200), (673.5, 245), (676, 268), (678.5, 300),
     (683.5, 400), (686, 420), (680, 440), (520, 440), (515, 400), (505, 345), (500.5, 315), (498, 285), (495, 260), (491.5, 245), (487, 192), (486, 160)],
    # deck, tape, battery, front beam, bracket legs and motors
    [(437, 309.5), (500, 309.5), (500, 330), (560, 400), (640, 400), (684, 330), (692, 327), (757, 327), (763, 345), (764, 368), (770, 384), (782, 392), (781, 409), (779.5, 420), (783, 437), (788.5, 459),
     (793, 462.5), (794, 470), (793, 479), (794.5, 487), (797, 492), (797, 501), (795, 508), (794.5, 533), (792, 534), (789, 532), (749, 531.5), (745.5, 515), (743.5, 508), (743.5, 491), (703, 490),
     (697, 487), (660, 486), (540, 485.5), (470, 485.5), (463, 487), (457, 488), (457, 528), (416, 527.5), (414.5, 529.5), (411.5, 529), (411.5, 494), (414, 480), (416, 460), (419.5, 440),
     (421.5, 424), (422.5, 400), (425, 398), (425, 392), (418.5, 391), (421, 372), (423, 352), (426, 340), (428, 331), (433, 328), (436, 322)],
    # connector on the battery lead
    [(406, 298), (412.5, 292), (419, 297), (429, 309), (435, 322), (434, 328), (431, 327), (423.5, 315), (418, 315.5), (410, 306)],
    # wheels
    [(357, 463), (360, 459.5), (391, 459.5), (394, 465), (395, 480), (395.5, 500), (394, 518), (394.5, 538), (390, 543), (383, 546), (372, 545), (360, 541), (355, 535), (354, 522), (353.5, 505), (354, 480)],
    [(814, 468), (817, 464.5), (822, 463.5), (844, 466), (849, 466), (854, 474), (856, 484), (858, 490), (857, 500), (855.5, 506), (858.5, 512), (858, 520), (856, 538), (852, 542), (844, 548), (830, 549), (815, 544), (809, 528), (809, 512), (809.5, 480)],
    [(385, 323.5), (412, 323.5), (415, 330), (416, 350), (416, 372), (414.5, 388), (411, 391), (390, 391), (383.5, 388), (382.5, 372), (382, 355), (382.5, 335)],
    [(764, 333), (767, 327), (776, 326), (781, 328), (788, 325.5), (796, 325), (799, 331), (800, 338), (802.5, 345), (802.5, 353), (800.5, 360), (800, 372), (801, 380), (800, 387), (780, 386), (770, 384), (763, 370), (763, 350)],
    # axles
    [(392, 494), (403, 494.5), (403, 499), (412, 499), (412, 502), (404, 503), (403, 507), (393, 505)], [(796, 503.5), (802, 503), (802, 499), (817, 498), (817, 511), (803, 511), (801.5, 507), (796, 507)], [(413, 352.5), (424, 352), (424, 361.5), (413, 361.5)],
    # cable coil and plug on the right
    [(778, 393), (786, 386.5), (800, 387.5), (808, 392), (807, 400), (802, 409), (794, 412.5), (785, 409), (780, 402)], [(806, 392), (812, 383), (817, 381.5), (822, 388), (825, 400), (823.5, 408), (818, 410.5), (810, 407), (805, 405)],
]
HOLES = [[(447, 435), (460, 441), (487, 452), (489, 456.5), (456, 457.5), (447.5, 450), (444.5, 447)], [(697, 457.5), (749, 428), (748, 440), (751, 447), (757, 449.5), (754, 454.5), (744, 458)]]
CABLES = [(655, 60), (668, 76), (674, 118), (688, 160), (690, 200), (690, 222), (708, 238), (722, 254), (735, 254), (752, 258), (752, 270), (764, 276), (790, 280), (793, 296), (788, 326), (806, 345), (812, 372), (830, 385), (829, 414), (790, 418), (750, 412), (676, 340), (668, 232)]


def mask(polys, blur=0.0, holes=()):
    m = Image.new('L', (W * S, H * S), 0); d = ImageDraw.Draw(m)
    for p in polys: d.polygon([(x * S, y * S) for x, y in p], fill=255)
    for p in holes: d.polygon([(x * S, y * S) for x, y in p], fill=0)
    if blur: m = m.filter(ImageFilter.GaussianBlur(blur * S))
    return np.asarray(m.resize((W, H), Image.BOX)).astype(np.float32) / 255


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)


L = src @ np.array([.2126, .7152, .0722], np.float32)
sat = src.max(2) - src.min(2)
solid = mask(SOLID, .75, HOLES)
# loose cables: black ones stay dark on the lit floor by themselves; only the red ones need the mask
key = sstep(.22, .38, src[..., 0] - src[..., 1])
rover = np.maximum(solid, mask([CABLES], 1.2) * key)

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32) + .5
# pool of light on the floor, centred under the machine, gone before every edge of the photograph
pool = np.exp(-(((xx - 606) / 330) ** 2 + ((yy - 430) / (np.where(yy < 430, 255, 140))) ** 2) ** 1.15)
pool *= sstep(0, 60, yy) * sstep(H, H - 52, yy) * sstep(0, 300, xx) * sstep(W, W - 330, xx)

# floor: cool, low, and a steeper curve so that the true shadow of the machine keeps its depth
fl = np.clip(L / .84, 0, 1.1) ** 1.7
floor = fl[..., None] * np.array([.450, .462, .480], np.float32) * (.80 + .20 * src / np.maximum(L[..., None], .02))
# rover: its own colours, a touch lower, cooler only in the shadows, a soft fall of light towards the ground
shape = .78 + .22 * np.exp(-(((xx - 610) / 330) ** 2 + ((yy - 190) / 330) ** 2))
tint = 1 + (1 - sstep(.10, .55, L))[..., None] * np.array([-.10, -.01, .10], np.float32)
body = np.clip(src, 0, 1) ** 1.06 * tint * shape[..., None] * .97

# straight alpha: colour is the mix of rover and floor, alpha is how much of the photograph shows over the studio
cov = np.maximum(rover, pool)
pre = body * rover[..., None] + floor * (pool * (1 - rover))[..., None]
rgb = pre / np.maximum(cov, 1e-3)[..., None]
out = np.dstack([np.clip(rgb, 0, 1), np.clip(cov, 0, 1)])
img = Image.fromarray((out * 255 + .5).astype(np.uint8), 'RGBA')
dst = os.path.join(ROOT, 'rover-real-graded.webp')
img.save(dst, 'WEBP', quality=92, alpha_quality=100, method=6, exact=True)
print(dst, os.path.getsize(dst), 'bytes')
if os.environ.get('PREVIEW'):
    bg = np.array([7, 8, 10], np.float32) / 255
    Image.fromarray((np.clip(pre + bg * (1 - cov[..., None]), 0, 1) * 255).astype(np.uint8)).resize((W * 3 // 2, H * 3 // 2), Image.LANCZOS).save(os.environ['PREVIEW'])
