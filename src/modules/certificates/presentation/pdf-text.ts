export interface PdfFont {
  characters: Record<string, (string | number)[]>;
  ascent: number;
}

export function textWidth(value: string, font: PdfFont, size: number): number {
  return (
    [...value].reduce(
      (width, character) => width + Number(font.characters[character]?.[1] ?? 0),
      0,
    ) * size
  );
}

export interface PdfTextBox {
  width: number;
  height: number;
  maximumSize: number;
  minimumSize: number;
}

function wrapText(value: string, font: PdfFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const character of value) {
    if (line && textWidth(line + character, font, size) > width) {
      const space = line.lastIndexOf(' ');
      if (space > 0) {
        lines.push(line.slice(0, space));
        line = line.slice(space + 1);
      } else {
        lines.push(line);
        line = '';
      }
    }
    line += character;
  }
  if (line) lines.push(line);
  return lines;
}

export function fitPdfText(value: string, font: PdfFont, box: PdfTextBox) {
  if ([...value].some((character) => !Object.hasOwn(font.characters, character)))
    throw new Error('PDF font does not support the certificate text');
  let lower = 0;
  let upper = Math.ceil((box.maximumSize - box.minimumSize) * 2);
  let fitted: { lines: string[]; size: number; lineHeight: number } | undefined;
  while (lower <= upper) {
    const step = Math.floor((lower + upper) / 2);
    const size = Math.max(box.minimumSize, box.maximumSize - step * 0.5);
    const lines = wrapText(value, font, size, box.width);
    const lineHeight = size * 1.12;
    if (
      lines.length * lineHeight <= box.height &&
      lines.every((line) => textWidth(line, font, size) <= box.width)
    ) {
      fitted = { lines, size, lineHeight };
      upper = step - 1;
    } else lower = step + 1;
  }
  if (fitted) return fitted;
  throw new Error('Certificate text exceeds its PDF slot');
}
