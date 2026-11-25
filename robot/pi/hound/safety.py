"""What is allowed, whatever anyone asked for. Every wish to move goes through here last."""
import math

class Safety:
    """Speeds come down with distance, and to zero when the rover cannot be sure: link silent, a sensor stale, the pack low, the rover tipping."""
    STOP_AT, SLOW_AT, DECEL = .25, .90, 1.8
    def __init__(self, vmax=.415): self.vmax = vmax; self.why = []; self.operator_t = -9.0; self.latched = None
    def operator(self, t): self.operator_t = t
    def all_stop(self, why): self.latched = self.latched or why
    def release(self): self.latched = None
    def allow(self, want, t, front=None, rear=None, tof_t=None, volts=0.0, tilt=0.0, drive_alive=True, scan=None):
        x, y, w = want; self.why = []
        def halt(m): self.why.append(m); return 0.0, 0.0, 0.0
        if self.latched: return halt('all stop: ' + self.latched)
        if not all(map(math.isfinite, want)): return halt('not a number')
        if not drive_alive: return halt('the motor board is silent')
        if t - self.operator_t > 1.0: return halt('no operator for a second')
        if abs(tilt) > .44: return halt(f'tilted {math.degrees(abs(tilt)):.0f} degrees')
        if 1 < volts < 10.5: return halt(f'pack at {volts:.1f} V')
        s = math.hypot(x, y)
        if s > self.vmax: x, y = x * self.vmax / s, y * self.vmax / s; self.why.append('speed limit')
        if 1 < volts < 10.8: x, y, w = x * .5, y * .5, w * .5; self.why.append('pack getting low')
        blindfront = tof_t is None or t - tof_t > .3
        for d, going in ((front, x > 0), (rear, x < 0)):
            if not going: continue
            if blindfront or d is None: x = math.copysign(min(abs(x), .10), x); self.why.append('distance sensor is silent, creeping'); continue
            room = max(0.0, d - self.STOP_AT); cap = math.sqrt(2 * self.DECEL * room) * .5                        # half of what could still stop in time
            if d < self.SLOW_AT and abs(x) > cap: x = math.copysign(cap, x); self.why.append(f'{d:.2f} m ahead')
        return x, y, w
