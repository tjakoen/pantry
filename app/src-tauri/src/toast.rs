// The toast icon: a slice of bread with the needs-you count inside it, drawn at runtime.
//
// It is PANTRY's dot-grid toast from the favicon, drawn as a template image (black and alpha, so macOS
// tints it for light and dark bars) with the number left out of the dots. It belongs to the menu bar
// only: the Dock keeps the bundle icon.

/// What the toast says: a count (zero shows a plain slice), or a dash while the hub is offline.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mark {
    Count(u32),
    Offline,
}

impl Mark {
    fn text(self) -> String {
        match self {
            Mark::Count(0) => String::new(),
            Mark::Count(n) if n > 9 => if n > 99 { "9+".into() } else { n.to_string() },
            Mark::Count(n) => n.to_string(),
            Mark::Offline => "-".into(),
        }
    }
}

// PANTRY's toast, dot for dot from icons/favicon-source.svg: C is crust, o is crumb, # is the face.
const TOAST: [&str; 10] = [
    "..CCCCCC..",
    ".CooooooC.",
    "CooooooooC",
    "CooooooooC",
    ".Co#ooooC.",
    ".Coo#oooC.",
    ".Co#ooooC.",
    ".Cooo###C.",
    ".CooooooC.",
    ".CCCCCCCC.",
];

// A 3x5 bitmap font, one dot per bit.
fn glyph(c: char) -> [u8; 5] {
    match c {
        '0' => [0b111, 0b101, 0b101, 0b101, 0b111],
        '1' => [0b010, 0b110, 0b010, 0b010, 0b111],
        '2' => [0b111, 0b001, 0b111, 0b100, 0b111],
        '3' => [0b111, 0b001, 0b111, 0b001, 0b111],
        '4' => [0b101, 0b101, 0b111, 0b001, 0b001],
        '5' => [0b111, 0b100, 0b111, 0b001, 0b111],
        '6' => [0b111, 0b100, 0b111, 0b101, 0b111],
        '7' => [0b111, 0b001, 0b010, 0b010, 0b010],
        '8' => [0b111, 0b101, 0b111, 0b101, 0b111],
        '9' => [0b111, 0b101, 0b111, 0b001, 0b111],
        '+' => [0b000, 0b010, 0b111, 0b010, 0b000],
        '-' => [0b000, 0b000, 0b111, 0b000, 0b000],
        _ => [0; 5],
    }
}

/// The 10x10 dot map for a mark: the face when nothing is waiting, otherwise the number set in
/// face-coloured dots on rows 3 to 7.
fn cells(mark: Mark) -> [[u8; 10]; 10] {
    let mut grid = [[b'.'; 10]; 10];
    for (y, row) in TOAST.iter().enumerate() {
        for (x, c) in row.bytes().enumerate() {
            grid[y][x] = c;
        }
    }
    let text = mark.text();
    if text.is_empty() {
        return grid;
    }
    for row in grid.iter_mut() {
        for c in row.iter_mut() {
            if *c == b'#' { *c = b'o'; }
        }
    }
    let chars: Vec<char> = text.chars().collect();
    // One character sits in the middle. Two need seven columns with the gap, one more than the crumb
    // has below the shoulders, so the pair runs over the left crust and keeps its gap.
    let lefts: &[usize] = if chars.len() == 1 { &[3] } else { &[1, 5] };
    for (ch, &left) in chars.iter().zip(lefts) {
        for (dy, bits) in glyph(*ch).iter().enumerate() {
            for dx in 0..3 {
                if bits >> (2 - dx) & 1 == 1 {
                    grid[3 + dy][left + dx] = b'#';
                }
            }
        }
    }
    grid
}

/// RGBA pixels for a square icon `size` pixels wide.
pub fn render(mark: Mark, size: u32) -> Vec<u8> {
    let grid = cells(mark);
    // The favicon's geometry: dots 3.2 apart, radius 1.45, in a 32-unit square.
    let unit = 32.0 / size as f32;
    const SS: u32 = 4;
    let mut out = Vec::with_capacity((size * size * 4) as usize);
    for py in 0..size {
        for px in 0..size {
            let (mut a, mut r, mut g, mut b) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
            for sy in 0..SS {
                for sx in 0..SS {
                    let x = (px as f32 + (sx as f32 + 0.5) / SS as f32) * unit;
                    let y = (py as f32 + (sy as f32 + 0.5) / SS as f32) * unit;
                    let (gx, gy) = ((x / 3.2) as usize, (y / 3.2) as usize);
                    if gx > 9 || gy > 9 {
                        continue;
                    }
                    let (cx, cy) = (gx as f32 * 3.2 + 1.6, gy as f32 * 3.2 + 1.6);
                    if (x - cx).powi(2) + (y - cy).powi(2) > 1.45 * 1.45 {
                        continue;
                    }
                    // A template image: every dot black, the number left out so the bar shows through.
                    if matches!(grid[gy][gx], b'.' | b'#') {
                        continue;
                    }
                    let colour = (0u8, 0u8, 0u8);
                    a += 1.0;
                    r += colour.0 as f32;
                    g += colour.1 as f32;
                    b += colour.2 as f32;
                }
            }
            if a == 0.0 {
                out.extend_from_slice(&[0, 0, 0, 0]);
            } else {
                let n = (SS * SS) as f32;
                out.extend_from_slice(&[(r / a) as u8, (g / a) as u8, (b / a) as u8, (a / n * 255.0) as u8]);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caps_at_nine_plus() {
        assert_eq!(Mark::Count(4).text(), "4");
        assert_eq!(Mark::Count(42).text(), "42");
        assert_eq!(Mark::Count(140).text(), "9+");
        assert_eq!(Mark::Count(0).text(), "");
    }

    #[test]
    fn number_is_cut_out_of_the_template() {
        let plain = render(Mark::Count(0), 44);
        let four = render(Mark::Count(4), 44);
        let opaque = |px: &[u8]| px.chunks(4).filter(|p| p[3] > 128).count();
        assert!(opaque(&four) < opaque(&plain), "the digit should remove pixels from the slice");
    }
}
