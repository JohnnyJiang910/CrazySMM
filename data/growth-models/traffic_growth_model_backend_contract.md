# 流量计划后台接入包

## 结论

CSV/MD 研究表不应该直接进后台。后台应该接入这套归一化模板：

- 只存模型元信息和每半小时的比例。
- 运行时输入 `targetViews`、`horizonDays`、`modelId`。
- 后台按比例实时计算 `incrementViews` 和 `cumulativeViews`。

## 推荐接口

```http
GET /api/traffic-growth/models
POST /api/traffic-growth/simulate
```

### POST /api/traffic-growth/simulate

```json
{
  "modelId": "M02",
  "horizonDays": 3,
  "targetViews": 100000,
  "startAt": "2026-07-10T09:00:00.000Z"
}
```

返回每半小时计划：

```json
{
  "intervalMinutes": 30,
  "horizonDays": 3,
  "targetViews": 100000,
  "points": [
    {
      "slot": 1,
      "hourStart": 0,
      "hourEnd": 0.5,
      "incrementShare": 0.00001,
      "cumulativeShare": 0.00001,
      "incrementViews": 1,
      "cumulativeViews": 1
    }
  ]
}
```

## 文件说明

- `traffic_growth_model_manifest_v1.json`：模型清单，用于前端下拉、后台模型配置。
- `traffic_growth_model_templates_v1.json`：后台最推荐直接加载的完整模板。
- `traffic_growth_model_points_normalized_v1.csv`：适合导入数据库的归一化点表。
- `trafficGrowthModelService.ts`：TypeScript 运行时示例，可直接放进 Node/TS 后台改造。
- `traffic_growth_model_schema.sql`：数据库表结构建议。
- `example_request_response.json`：接口请求/响应示例。

## 为什么不直接用 10w CSV

固定 10w CSV 会把“目标浏览量”和“增长形态”耦合在一起。后台需要的是模板能力：

```text
incrementViews = incrementShare * targetViews
cumulativeViews = cumulativeShare * targetViews
```

这样同一套模型可以服务 20K、50K、100K、200K 或任意目标。
