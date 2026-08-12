import type { Block } from '../../extract.js';
import type { Rule } from '../types.js';

const PACKET_FIELD_RE =
  /^\s*(\+?\d+(?:\s*-\s*\d+)?)\s*:\s*(?:"([^"]*)"|'([^']*)')\s*(?:%%.*)?$/;

interface PacketField {
  range: string;
  label: string;
  line: number;
}

function isPacket(block: Block): boolean {
  return block.type === 'packet-beta';
}

function collectPacketFields(lines: string[]): PacketField[] {
  const fields: PacketField[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trimStart().startsWith('%%')) continue;
    const field = PACKET_FIELD_RE.exec(raw);
    if (field === null) continue;
    fields.push({
      range: field[1].replace(/\s+/g, ''),
      label: field[2] ?? field[3] ?? '',
      line: i + 1,
    });
  }
  return fields;
}

export const packetNoFields: Rule = {
  id: 'packet-no-fields',
  appliesTo: isPacket,
  evaluate: ({ lines, headerLine }) => {
    if (collectPacketFields(lines).length > 0) return [];
    return [
      {
        message:
          'packet-beta has no field rows (no fields); it parses but renders as an empty packet.',
        line: headerLine,
      },
    ];
  },
};

export const packetEmptyLabels: Rule = {
  id: 'packet-empty-labels',
  appliesTo: isPacket,
  evaluate: ({ lines }) =>
    collectPacketFields(lines)
      .filter((field) => field.label.trim() === '')
      .map((field) => ({
        message: `packet field \`${field.range}\` has an empty label and will render as a blank field.`,
        line: field.line,
      })),
};
