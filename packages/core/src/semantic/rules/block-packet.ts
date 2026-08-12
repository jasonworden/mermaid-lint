import type { Block } from '../../extract.js';
import type { Rule } from '../types.js';

const BLOCK_DECL_RE = /^\s*[A-Za-z_][\w-]*(?:\s*\[[^\]]*])?(?::\d+)?\s*$/;
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

export const blockNoBlocks: Rule = {
  id: 'block-no-blocks',
  appliesTo: (block) => block.type === 'block-beta',
  evaluate: ({ lines, headerLine }) => {
    if (
      lines.some((line) => {
        const trimmed = line.trim();
        return trimmed !== 'block-beta' && BLOCK_DECL_RE.test(trimmed);
      })
    ) {
      return [];
    }
    return [
      {
        message:
          'block-beta has no blocks and renders empty; add at least one block declaration.',
        line: headerLine,
      },
    ];
  },
};

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
