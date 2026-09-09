export type TrafficGrowthModelPoint = {
  modelId: string;
  horizonDays: number;
  slot: number;
  day: number;
  hourStart: number;
  hourEnd: number;
  progressStart: number;
  progressEnd: number;
  phase: string;
  incrementShare: number;
  cumulativeShare: number;
};

export type TrafficGrowthModel = {
  id: string;
  key: string;
  name: string;
  family: string;
  useCase: string;
  timingBasis: string;
  peakWindows: Record<string, string>;
  peakHalfHourViewsAt100k: Record<string, number | null>;
};

export type TrafficGrowthTemplates = {
  version: string;
  generatedAt: string;
  targetIndependent: boolean;
  intervalMinutes: number;
  supportedHorizonDays: number[];
  models: TrafficGrowthModel[];
  points: TrafficGrowthModelPoint[];
};

export type SimulateGrowthInput = {
  modelId: string;
  horizonDays: number;
  targetViews: number;
  startAt?: string | Date;
};

export type SimulatedGrowthPoint = TrafficGrowthModelPoint & {
  plannedAt?: string;
  incrementViews: number;
  cumulativeViews: number;
};

export function getTrafficGrowthModels(templates: TrafficGrowthTemplates) {
  return templates.models;
}

export function simulateTrafficGrowth(
  templates: TrafficGrowthTemplates,
  input: SimulateGrowthInput,
) {
  const horizonDays = Math.round(input.horizonDays);
  const targetViews = Math.round(input.targetViews);
  if (!Number.isFinite(targetViews) || targetViews <= 0) {
    throw new Error("targetViews must be a positive number");
  }

  const model = templates.models.find((item) => item.id === input.modelId);
  if (!model) throw new Error(`Unknown modelId: ${input.modelId}`);
  if (!templates.supportedHorizonDays.includes(horizonDays)) {
    throw new Error(`Unsupported horizonDays: ${input.horizonDays}`);
  }

  const sourcePoints = templates.points
    .filter((point) => point.modelId === input.modelId && point.horizonDays === horizonDays)
    .sort((a, b) => a.slot - b.slot);

  if (!sourcePoints.length) {
    throw new Error(`No model points for ${input.modelId}/${horizonDays}d`);
  }

  const rawIncrements = sourcePoints.map((point) => point.incrementShare * targetViews);
  const incrementViews = rawIncrements.map(Math.floor);
  let remaining = targetViews - incrementViews.reduce((sum, value) => sum + value, 0);
  const remainderOrder = rawIncrements
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; i < remaining; i += 1) {
    incrementViews[remainderOrder[i % remainderOrder.length].index] += 1;
  }

  const startDate = input.startAt ? new Date(input.startAt) : null;
  let cumulativeViews = 0;
  const points: SimulatedGrowthPoint[] = sourcePoints.map((point, index) => {
    cumulativeViews += incrementViews[index];
    const plannedAt = startDate
      ? new Date(startDate.getTime() + point.hourEnd * 60 * 60 * 1000).toISOString()
      : undefined;
    return {
      ...point,
      plannedAt,
      incrementViews: incrementViews[index],
      cumulativeViews,
    };
  });

  return {
    version: templates.version,
    intervalMinutes: templates.intervalMinutes,
    model,
    horizonDays,
    targetViews,
    points,
  };
}
