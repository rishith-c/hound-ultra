"""From a point in the picture to a point on the ground, and how far off that could be."""
import math
import numpy as np


class Camera:
    """A pinhole camera that looks down. fx, fy in pixels; the camera's own axes are right, down the picture, and into the scene."""

    def __init__(self, width=1280, height=960, fov=math.radians(62)):
        self.w, self.h = width, height; self.f = width / 2 / math.tan(fov / 2)

    def ray(self, u, v): d = np.array([(u - self.w / 2) / self.f, (v - self.h / 2) / self.f, 1.0]); return d / np.linalg.norm(d)


DOWN = np.array([[0, -1, 0], [-1, 0, 0], [0, 0, -1]], float)      # camera (right, picture-down, ahead) in the drone's body (forward, left, up): looking straight down, picture-up is forward


def rotation(roll, pitch, yaw):
    cr, sr, cp, sp, cy, sy = math.cos(roll), math.sin(roll), math.cos(pitch), math.sin(pitch), math.cos(yaw), math.sin(yaw)
    return np.array([[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr], [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr], [-sp, cp * sr, cp * cr]])


def to_ground(cam, u, v, pos, rpy, plane=(0.0, 0.0, 1.0, 0.0), sd_pos=.25, sd_ang=math.radians(1.0), sd_px=4.0):
    """plane = (a, b, c, d): a x + b y + c z = d. Returns (point, one-sigma radius in metres), or None when the ray never meets the ground in front of the camera."""
    R = rotation(*rpy); n, d = np.array(plane[:3]), plane[3]; pos = np.asarray(pos, float)

    def hit(R_, uv):
        r = R_ @ DOWN @ cam.ray(*uv); k = n @ r
        if abs(k) < .05: return None
        s = (d - n @ pos) / k
        return pos + s * r if 0 < s < 400 else None
    p = hit(R, (u, v))
    if p is None: return None
    var = 2 * sd_pos ** 2
    for q in ((rotation(rpy[0] + sd_ang, rpy[1], rpy[2]), (u, v)), (rotation(rpy[0], rpy[1] + sd_ang, rpy[2]), (u, v)), (rotation(rpy[0], rpy[1], rpy[2] + 2 * sd_ang), (u, v)), (R, (u + sd_px, v)), (R, (u, v + sd_px))):
        h = hit(*q)
        if h is None: return None
        var += float(((h - p) ** 2).sum())                        # what one sigma in each would move the pin
    return p, math.sqrt(var)
