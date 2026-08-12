import {
  architectureDuplicateEdge,
  architectureNoEdges,
  architectureNoElements,
} from './rules/architecture.js';
import {
  blockNoBlocks,
  packetEmptyLabels,
  packetNoFields,
} from './rules/block-packet.js';
import {
  c4DuplicateId,
  c4UndefinedElementStyle,
  c4UndefinedRelationshipEndpoint,
  c4UndefinedRelationshipStyleEndpoint,
} from './rules/c4.js';
import {
  erDuplicateAttribute,
  erDuplicateEntity,
  erStandaloneEntity,
} from './rules/er.js';
import {
  eventmodelingDuplicateFrameId,
  eventmodelingInvalidFlow,
  eventmodelingUndefinedFrame,
} from './rules/eventmodeling.js';
import {
  duplicateIds,
  noDuplicateEdges,
  noDuplicateNodeDeclarations,
  noEmptyLabels,
  noOrphanNodes,
  noSelfLoop,
} from './rules/flowchart.js';
import {
  ganttDuplicateTaskId,
  ganttEmptySection,
  ganttUndefinedDependency,
} from './rules/gantt.js';
import {
  frontmatterMustBeFirst,
  noExperimental,
  preferFlowchart,
  requireDirection,
} from './rules/general.js';
import {
  gitgraphDuplicateCommitId,
  gitgraphDuplicateTag,
  gitgraphNoCommits,
} from './rules/gitgraph.js';
import {
  ishikawaDeepNesting,
  ishikawaDuplicateSibling,
  ishikawaEmptyCategory,
  ishikawaNoCauses,
} from './rules/ishikawa.js';
import {
  journeyEmptySection,
  journeyNoTasks,
  journeyScoreOutOfRange,
  journeyTaskWithoutActor,
} from './rules/journey.js';
import {
  kanbanDuplicateColumn,
  kanbanDuplicateTaskId,
  kanbanEmptyColumn,
  kanbanNoColumns,
} from './rules/kanban.js';
import {
  mindmapDeepNesting,
  mindmapDuplicateSibling,
  mindmapNoNodes,
} from './rules/mindmap.js';
import { pieDuplicateLabel, pieNoData, pieZeroValue } from './rules/pie.js';
import {
  quadrantDuplicatePoint,
  quadrantDuplicateQuadrant,
  quadrantMissingXAxis,
  quadrantMissingYAxis,
  quadrantNoPoints,
} from './rules/quadrant.js';
import {
  requirementDuplicateId,
  requirementDuplicateName,
  requirementUndefinedReference,
} from './rules/requirement.js';
import {
  sankeyDuplicateLink,
  sankeyNonPositiveValue,
  sankeySelfLoop,
} from './rules/sankey.js';
import {
  classDuplicateClass,
  noActivateWithoutDeactivate,
  noDuplicateMethods,
  preferExplicitParticipants,
  sequenceDuplicateParticipant,
} from './rules/sequence-class.js';
import {
  stateDuplicateState,
  stateDuplicateTransition,
  stateEmptyComposite,
  stateSelfTransition,
} from './rules/state.js';
import {
  timelineEmptyEvent,
  timelineEmptySection,
  timelineNoEntries,
} from './rules/timeline.js';
import {
  treemapBranchWithValue,
  treemapDuplicateSibling,
  treemapNoLeaves,
  treemapZeroValue,
} from './rules/treemap.js';
import { treeviewDuplicateSibling, treeviewNoNodes } from './rules/treeview.js';
import {
  vennDuplicateSet,
  vennDuplicateUnion,
  vennNoSets,
  vennNonPositiveSize,
  vennSelfUnion,
  vennSingleSet,
} from './rules/venn.js';
import {
  wardleyDuplicateComponent,
  wardleyMixedCoordinateScale,
  wardleyNoComponents,
  wardleyOrphanComponent,
  wardleyUndefinedComponent,
} from './rules/wardley.js';
import {
  radarCurveLengthMismatch,
  radarDuplicateAxis,
  radarNoCurves,
  xychartMissingXAxis,
  xychartMissingYAxis,
  xychartNoSeries,
  xychartSeriesLengthMismatch,
} from './rules/xychart-radar.js';
import type { Rule } from './types.js';

export const RULES: Rule[] = [
  // First: "this will not render at all" outranks any finding about the
  // diagram's contents.
  frontmatterMustBeFirst,
  preferFlowchart,
  requireDirection,
  noExperimental,
  xychartMissingXAxis,
  xychartMissingYAxis,
  xychartNoSeries,
  xychartSeriesLengthMismatch,
  radarNoCurves,
  radarCurveLengthMismatch,
  radarDuplicateAxis,
  treemapZeroValue,
  treemapNoLeaves,
  treemapDuplicateSibling,
  treemapBranchWithValue,
  sankeyNonPositiveValue,
  sankeyDuplicateLink,
  sankeySelfLoop,
  blockNoBlocks,
  packetNoFields,
  packetEmptyLabels,
  architectureNoElements,
  architectureNoEdges,
  architectureDuplicateEdge,
  duplicateIds,
  noDuplicateNodeDeclarations,
  noDuplicateEdges,
  noSelfLoop,
  noEmptyLabels,
  noOrphanNodes,
  noActivateWithoutDeactivate,
  preferExplicitParticipants,
  sequenceDuplicateParticipant,
  classDuplicateClass,
  noDuplicateMethods,
  pieDuplicateLabel,
  pieZeroValue,
  pieNoData,
  stateDuplicateState,
  stateDuplicateTransition,
  stateEmptyComposite,
  stateSelfTransition,
  erDuplicateAttribute,
  erDuplicateEntity,
  erStandaloneEntity,
  requirementDuplicateName,
  requirementDuplicateId,
  requirementUndefinedReference,
  ganttDuplicateTaskId,
  ganttUndefinedDependency,
  ganttEmptySection,
  journeyEmptySection,
  journeyScoreOutOfRange,
  journeyTaskWithoutActor,
  journeyNoTasks,
  mindmapDuplicateSibling,
  mindmapNoNodes,
  mindmapDeepNesting,
  timelineEmptySection,
  timelineEmptyEvent,
  timelineNoEntries,
  gitgraphDuplicateCommitId,
  gitgraphDuplicateTag,
  gitgraphNoCommits,
  quadrantDuplicatePoint,
  quadrantNoPoints,
  quadrantMissingXAxis,
  quadrantMissingYAxis,
  quadrantDuplicateQuadrant,
  c4DuplicateId,
  c4UndefinedRelationshipEndpoint,
  c4UndefinedElementStyle,
  c4UndefinedRelationshipStyleEndpoint,
  wardleyUndefinedComponent,
  wardleyOrphanComponent,
  wardleyNoComponents,
  wardleyMixedCoordinateScale,
  wardleyDuplicateComponent,
  eventmodelingUndefinedFrame,
  eventmodelingDuplicateFrameId,
  eventmodelingInvalidFlow,
  kanbanDuplicateColumn,
  kanbanDuplicateTaskId,
  kanbanEmptyColumn,
  kanbanNoColumns,
  vennDuplicateSet,
  vennNonPositiveSize,
  vennSingleSet,
  vennSelfUnion,
  vennNoSets,
  vennDuplicateUnion,
  treeviewNoNodes,
  treeviewDuplicateSibling,
  ishikawaNoCauses,
  ishikawaEmptyCategory,
  ishikawaDeepNesting,
  ishikawaDuplicateSibling,
];
