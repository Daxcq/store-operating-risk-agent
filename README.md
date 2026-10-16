# 莱森购 Retail Intelligence Agent

无人零售经营智能决策平台 Demo。系统围绕“发现问题、解释差距、生成行动、复核结果”组织门店经营分析。

## 当前 Demo

当前版本是一个 React + Vite 前端 Demo，使用长春门店模拟数据，包含：

- 风险地图：查看门店经营状态和重点风险；
- 门店对标：比较销售额、订单数、客单价和退款率；
- 门店详情：查看差距拆解和趋势外推；
- 风险案件：查看证据、行动建议、负责人和复核条件。

当前数据保存在前端代码中，尚未接入真实后端、数据库或 Agent 服务。

## 快速开始

环境要求：Node.js 18 或更高版本。

```bash
npm install
npm run dev
```

打开终端输出的本地地址即可查看 Demo。

生产构建：

```bash
npm run build
npm run preview
```

## Demo 演示路径

1. 在风险地图中选择 A 店；
2. 查看销售额下降、订单数贡献和退款率异常；
3. 进入门店对标，比较同区域门店；
4. 打开风险案件，查看证据和“抽查最近 20 笔退款订单”的行动建议；
5. 说明下一周期可根据退款率复核案件是否关闭或升级。

## 技术栈

- React
- Vite
- React Leaflet / OpenStreetMap
- Lucide React
- CSS

## 项目结构

```text
index.html       Vite 入口
src/main.jsx     页面、交互和当前 Demo 数据
src/styles.css   页面样式
PROJECT.md       产品范围、页面架构和演示验收
TECHNICAL_ARCHITECTURE.md
                 当前实现与生产目标架构
```

## 文档

- [PROJECT.md](./PROJECT.md)：产品定位、页面范围、数据契约和 Demo 验收标准。
- [TECHNICAL_ARCHITECTURE.md](./TECHNICAL_ARCHITECTURE.md)：前后端分离、Agent 工具、数据层和生产演进方案。

## 当前限制

- 使用模拟门店数据，数据不会持久化；
- 风险规则和计算逻辑仍主要在前端展示层；
- Agent 决策工作台、真实审计服务和任务后端尚未接入；
- 地图底图需要网络访问 OpenStreetMap；
- 当前版本面向 Demo 演示，不作为生产系统部署。

## 后续方向

先抽离数据和指标服务，再接入白名单工具式 Agent、案件与任务持久化、用户权限、真实数据源和复核闭环。详见技术架构文档。
