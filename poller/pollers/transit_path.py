"""Bounded, publisher-shape route matching for GTFS vehicle positions."""
import math


def motion_path(lon, lat, bearing, speed_mps, lines, is_bus):
    """Return a short forward shape path only when a measured fix matches its trip."""
    if not lines or bearing is None or speed_mps is None or speed_mps < 1:
        return None
    meters_lon = 111_320 * max(0.2, abs(math.cos(math.radians(lat))))
    meters_lat = 110_540
    nearest = None
    for line in lines:
        for i, (a, b) in enumerate(zip(line, line[1:])):
            ax, ay = (a[0]-lon)*meters_lon, (a[1]-lat)*meters_lat
            dx, dy = (b[0]-a[0])*meters_lon, (b[1]-a[1])*meters_lat
            length_sq = dx*dx + dy*dy
            if length_sq < 1: continue
            fraction = max(0, min(1, -(ax*dx+ay*dy)/length_sq))
            offset = math.hypot(ax+fraction*dx, ay+fraction*dy)
            if offset > (45 if is_bus else 80): continue
            course = (math.degrees(math.atan2(dx, dy))+360) % 360
            angle = abs((course-bearing+180) % 360-180)
            if angle > 70: continue
            score = offset + angle*0.15
            if nearest is None or score < nearest[0]:
                nearest = (score, offset, line, i, fraction)
    if nearest is None: return None
    _, offset, line, i, fraction = nearest
    start = [round(line[i][0]+(line[i+1][0]-line[i][0])*fraction, 6),
             round(line[i][1]+(line[i+1][1]-line[i][1])*fraction, 6)]
    points = [start]
    remaining = min(speed_mps*25, 700 if is_bus else 1_500)
    for vertex in line[i+1:]:
        a = points[-1]
        dx, dy = (vertex[0]-a[0])*meters_lon, (vertex[1]-a[1])*meters_lat
        length = math.hypot(dx, dy)
        if length < 0.1: continue
        if length >= remaining:
            ratio = remaining/length
            points.append([round(a[0]+(vertex[0]-a[0])*ratio, 6),
                           round(a[1]+(vertex[1]-a[1])*ratio, 6)])
            break
        points.append(vertex)
        remaining -= length
        if len(points) >= 48: break
    if len(points) < 2: return None
    return {'points': points, 'match_m': round(offset, 1)}
