# Future Domain Applications

> Sample applications that extend Ratchet to new problem spaces using the same
> tool + agent + pipeline architecture. Each follows the established pattern:
> define tools, seed an agent, create a scheduled pipeline, write E2E scenarios.

---

## Customer Experience

### Use Case: Support Intelligence Agent

An agent that monitors support channels, triages incoming requests by urgency and topic, suggests responses based on past resolutions, and escalates critical issues to humans.

**Agent:** `CustomerInsight` (role: `customer-support`)

**Tools needed:**
| Tool | Description | Implementation |
|------|-------------|----------------|
| `ticket_search` | Query support ticket systems by status, priority, assignee | REST API integration (Zendesk, Freshdesk, Linear) |
| `sentiment_analyze` | Score text sentiment and detect frustration/urgency | LLM-based analysis or external API (Google NLP, AWS Comprehend) |
| `response_suggest` | Generate response drafts from knowledge base + past resolutions | LLM reasoning over indexed KB articles |
| `kb_search` | Search knowledge base for relevant articles | FTS5 or external search (Algolia, Elasticsearch) |

**Pipeline:** `support-triage` (every 5 minutes)
- Fetch open unassigned tickets
- Classify urgency (critical/high/normal/low)
- For critical: create approval request for human review
- For normal/low: suggest response, save to memory

**Agentic Loop:** Receive ticket → Classify intent → Search KB → Attempt resolution → Monitor satisfaction → Escalate if needed → Update knowledge → Improve

**Integration points:** Helpdesk APIs, CRM systems, email/chat webhooks

---

### Use Case: User Journey Analyst

An agent that analyzes user behavior patterns, identifies drop-off points in funnels, and recommends UX improvements based on cohort analysis.

**Agent:** `JourneyAnalyst` (role: `analytics`)

**Tools needed:**
| Tool | Description | Implementation |
|------|-------------|----------------|
| `event_query` | Query analytics events by user, session, event type | SQL against analytics DB or API (Amplitude, Mixpanel) |
| `funnel_analyze` | Compute conversion rates between defined funnel steps | SQL aggregation with step-by-step drop-off |
| `cohort_compare` | Compare metrics across user cohorts (A/B, time-based) | Statistical comparison with significance testing |

**Pipeline:** `journey-analysis` (daily)
- Query recent user sessions
- Compute funnel conversion rates
- Compare against previous period
- Identify significant drop-offs
- Save insights to memory

**Agentic Loop:** Explore sessions → Identify patterns → Form hypotheses → Validate findings → Generate insights → Track adoption → Refine discovery

---

## Business Operations

### Use Case: Process Automation Monitor

An agent that monitors business workflow health, tracks SLA compliance, and detects bottlenecks in operational processes.

**Agent:** `ProcessGuard` (role: `business-ops`)

**Tools needed:**
| Tool | Description | Implementation |
|------|-------------|----------------|
| `workflow_status` | Check health of business workflows (running, stuck, failed) | Query workflow engine execution state |
| `sla_check` | Verify SLA compliance for active processes | Compare timestamps against SLA thresholds |
| `bottleneck_detect` | Identify queue depth and processing delays | Analyze pending task counts by stage |
| `alert_send` | Send notifications to operations team | Slack/email/PagerDuty integration |

**Pipeline:** `process-monitor` (every 15 minutes)
- Check all active workflow instances
- Flag SLA violations
- Detect processing bottlenecks (queue depth > threshold)
- Alert operations team for critical issues
- Save patterns to memory

**Agentic Loop:** Monitor workflows → Detect anomalies → Check SLAs → Alert team → Track resolution → Optimize thresholds → Prevent future violations

---

### Use Case: Resource Planner

An agent that analyzes resource utilization trends, forecasts capacity needs, and recommends cost optimizations.

**Agent:** `ResourcePlanner` (role: `planning`)

**Tools needed:**
| Tool | Description | Implementation |
|------|-------------|----------------|
| `capacity_forecast` | Project resource needs based on growth trends | Time-series analysis on historical metrics |
| `cost_analyze` | Break down cloud/infrastructure costs by service | Cloud provider billing APIs (AWS Cost Explorer, GCP Billing) |
| `utilization_report` | Compute resource efficiency across services | Aggregate k8s_top data over time windows |

**Pipeline:** `resource-review` (weekly)
- Collect utilization metrics for past week
- Compare against capacity thresholds
- Compute cost trends
- Generate optimization recommendations
- Save to memory for trend tracking

**Agentic Loop:** Analyze spending → Predict needs → Research options → Evaluate trade-offs → Recommend actions → Monitor impact → Adjust strategy

---

## Research & Development

### Use Case: Research Assistant

An agent that monitors academic publications, tracks technology trends relevant to the project, and summarizes findings for the team.

**Agent:** `ResearchBot` (role: `research`)

**Tools needed:**
| Tool | Description | Implementation |
|------|-------------|----------------|
| `paper_search` | Search academic papers by topic, author, date | arXiv API, Semantic Scholar API |
| `patent_check` | Query patent databases for prior art | Google Patents API, USPTO |
| `trend_analyze` | Analyze technology adoption trends | GitHub trending, npm downloads, Stack Overflow tags |
| `summarize` | Generate concise summaries of technical papers | LLM-based summarization |

**Pipeline:** `research-scan` (daily)
- Search for new papers in configured topic areas
- Check for relevant patents
- Analyze technology trends
- Summarize top findings
- Save to memory knowledge base

**Agentic Loop:** Monitor sources → Identify relevant papers → Summarize findings → Assess applicability → Share with team → Track which insights led to action → Refine search criteria

---

### Use Case: Experiment Tracker

An agent that monitors A/B tests and experiments, detects statistical significance, and recommends early stopping or scaling decisions.

**Agent:** `ExperimentGuard` (role: `experimentation`)

**Tools needed:**
| Tool | Description | Implementation |
|------|-------------|----------------|
| `experiment_status` | Check running experiments for health and progress | Query experiment platform (LaunchDarkly, Split, custom) |
| `metric_compare` | Statistical comparison between control and variants | Chi-squared, t-test, Bayesian analysis |
| `result_summarize` | Generate experiment conclusion reports | LLM reasoning over statistical results |

**Pipeline:** `experiment-check` (every 6 hours)
- List all running experiments
- Check sample sizes against power requirements
- Compute statistical significance
- Flag experiments ready for decision
- Generate summary reports

**Agentic Loop:** Design experiment → Execute test → Monitor metrics → Analyze results → Make decisions → Scale winners → Generate insights

---

## Implementation Pattern

Each domain application follows the same architecture:

1. **Tools** — Go structs in `ratchetplugin/tools/` implementing `plugin.Tool`
2. **Agent** — Seed definition in `config/modules.yaml` with system prompt
3. **Pipeline** — Scheduled pipeline in `config/pipelines-{domain}.yaml`
4. **Triggers** — Cron schedule in `config/triggers.yaml`
5. **Scenarios** — Scripted test YAML in `testdata/scenarios/`
6. **E2E Script** — Bash test in `scripts/`

The tools provide data access; the LLM agent provides reasoning, correlation, and decision-making. Memory enables continuous learning across runs.
