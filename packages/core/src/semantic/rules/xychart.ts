import type { Block } from '../../extract.js';
import { parseCsvCells } from '../helpers.js';
import { commaItemCount } from '../helpers.js';
import type { Rule, RuleFinding } from '../types.js';

interface XychartSeries {
  kind: 'line' | 'bar';
  length: number;
  line: number;
}

interface ParsedXychart {
  hasXAxis: boolean;
  xAxisLabelCount?: number;
  hasYAxis: boolean;
  series: XychartSeries[];
}

const XYCHART_X_AXIS_RE = /^\s*x-axis\b/;
const XYCHART_Y_AXIS_RE = /^\s*y-axis\b/;
const XYCHART_CATEGORICAL_X_AXIS_RE =
  /^\s*x-axis(?:\s+(?:"[^"]+"|[^\[\n]+?))?\s*\[(.*)\]\s*$/;
const XYCHART_SERIES_RE = /^\s*(line|bar)\s*\[(.*)\]\s*$/;

function isXychart(block: Block): boolean {
  return block.type === 'xychart-beta';
}

function parseXychart(lines: string[]): ParsedXychart {
  const parsed: ParsedXychart = {
    hasXAxis: false,
    hasYAxis: false,
    series: [],
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '' || trimmed.startsWith('%%')) continue;

    if (XYCHART_X_AXIS_RE.test(trimmed)) {
      parsed.hasXAxis = true;
      const categorical = XYCHART_CATEGORICAL_X_AXIS_RE.exec(trimmed);
      if (categorical !== null) {
        parsed.xAxisLabelCount = commaItemCount(categorical[1]);
      }
      continue;
    }

    if (XYCHART_Y_AXIS_RE.test(trimmed)) {
      parsed.hasYAxis = true;
      continue;
    }

    const series = XYCHART_SERIES_RE.exec(trimmed);
    if (series === null) continue;
    parsed.series.push({
      kind: series[1] as XychartSeries['kind'],
      length: commaItemCount(series[2]),
      line: i + 1,
    });
  }

  return parsed;
}

export const xychartMissingXAxis: Rule = {
  id: 'xychart-missing-x-axis',
  appliesTo: isXychart,
  evaluate: ({ lines, headerLine }) => {
    const chart = parseXychart(lines);
    if (chart.series.length === 0 || chart.hasXAxis) return [];
    return [
      {
        message:
          'xychart-beta has data series but no `x-axis`; add an explicit axis so the horizontal scale and labels are clear.',
        line: headerLine,
      },
    ];
  },
};

export const xychartMissingYAxis: Rule = {
  id: 'xychart-missing-y-axis',
  appliesTo: isXychart,
  evaluate: ({ lines, headerLine }) => {
    const chart = parseXychart(lines);
    if (chart.series.length === 0 || chart.hasYAxis) return [];
    return [
      {
        message:
          'xychart-beta has data series but no `y-axis`; add an explicit axis so the vertical scale and units are clear.',
        line: headerLine,
      },
    ];
  },
};

export const xychartNoSeries: Rule = {
  id: 'xychart-no-series',
  appliesTo: isXychart,
  evaluate: ({ lines, headerLine }) => {
    if (parseXychart(lines).series.length > 0) return [];
    return [
      {
        message:
          'xychart-beta has no data series and renders no data; add at least one `line [...]` or `bar [...]` series.',
        line: headerLine,
      },
    ];
  },
};

export const xychartSeriesLengthMismatch: Rule = {
  id: 'xychart-series-length-mismatch',
  appliesTo: isXychart,
  evaluate: ({ lines, fileLine }) => {
    const chart = parseXychart(lines);
    if (chart.series.length === 0) return [];

    const findings: RuleFinding[] = [];
    if (chart.xAxisLabelCount !== undefined) {
      for (const series of chart.series) {
        if (series.length === chart.xAxisLabelCount) continue;
        findings.push({
          message: `${series.kind} series has ${series.length} values but the categorical \`x-axis\` defines ${chart.xAxisLabelCount} labels; these lengths should match.`,
          line: series.line,
        });
      }
      return findings;
    }

    const [first, ...rest] = chart.series;
    for (const series of rest) {
      if (series.length === first.length) continue;
      findings.push({
        message: `${series.kind} series has ${series.length} values but the first series on line ${fileLine(first.line)} has ${first.length}; xychart-beta series should use the same length.`,
        line: series.line,
      });
    }
    return findings;
  },
};
