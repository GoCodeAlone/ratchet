package tools

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/GoCodeAlone/ratchet/provider"
)

// DBAnalyzeTool runs EXPLAIN QUERY PLAN on SQL queries for optimization analysis.
type DBAnalyzeTool struct {
	DB *sql.DB
}

func (t *DBAnalyzeTool) Name() string { return "db_analyze" }
func (t *DBAnalyzeTool) Description() string {
	return "Analyze SQL query execution plans to identify optimization opportunities"
}
func (t *DBAnalyzeTool) Definition() provider.ToolDef {
	return provider.ToolDef{
		Name:        "db_analyze",
		Description: "Run EXPLAIN QUERY PLAN on a SQL query to analyze execution strategy. Identifies full table scans, index usage, and estimated cost.",
		Parameters: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{
					"type":        "string",
					"description": "The SQL SELECT query to analyze",
				},
			},
			"required": []string{"query"},
		},
	}
}

func (t *DBAnalyzeTool) Execute(_ context.Context, args map[string]any) (any, error) {
	query, ok := args["query"].(string)
	if !ok || query == "" {
		return nil, fmt.Errorf("db_analyze: 'query' is required")
	}

	if t.DB == nil {
		return map[string]any{"error": "database not configured"}, nil
	}

	normalized := strings.TrimSpace(strings.ToUpper(query))
	if !strings.HasPrefix(normalized, "SELECT") {
		return map[string]any{"error": "only SELECT queries can be analyzed"}, nil
	}

	rows, err := t.DB.Query("EXPLAIN QUERY PLAN " + query)
	if err != nil {
		return map[string]any{"error": fmt.Sprintf("explain failed: %v", err)}, nil
	}
	defer rows.Close()

	planLines := []string{}
	fullScan := false
	indexUsed := ""

	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			continue
		}
		planLines = append(planLines, detail)
		if strings.Contains(strings.ToUpper(detail), "SCAN") {
			fullScan = true
		}
		if strings.Contains(strings.ToUpper(detail), "INDEX") {
			parts := strings.Fields(detail)
			for i, p := range parts {
				if strings.ToUpper(p) == "INDEX" && i+1 < len(parts) {
					indexUsed = parts[i+1]
				}
			}
		}
	}

	return map[string]any{
		"plan":       strings.Join(planLines, "\n"),
		"full_scan":  fullScan,
		"index_used": indexUsed,
		"query":      query,
	}, nil
}

// DBHealthCheckTool checks SQLite database health metrics.
type DBHealthCheckTool struct {
	DB *sql.DB
}

func (t *DBHealthCheckTool) Name() string { return "db_health_check" }
func (t *DBHealthCheckTool) Description() string {
	return "Check database health: integrity, size, table stats, and free space"
}
func (t *DBHealthCheckTool) Definition() provider.ToolDef {
	return provider.ToolDef{
		Name:        "db_health_check",
		Description: "Run SQLite health checks: integrity verification, page counts, free pages, and per-table row counts.",
		Parameters: map[string]any{
			"type":       "object",
			"properties": map[string]any{},
		},
	}
}

func (t *DBHealthCheckTool) Execute(_ context.Context, _ map[string]any) (any, error) {
	if t.DB == nil {
		return map[string]any{"error": "database not configured"}, nil
	}

	var integrity string
	_ = t.DB.QueryRow("PRAGMA integrity_check").Scan(&integrity)

	var pageCount, freePages, pageSize int
	_ = t.DB.QueryRow("PRAGMA page_count").Scan(&pageCount)
	_ = t.DB.QueryRow("PRAGMA freelist_count").Scan(&freePages)
	_ = t.DB.QueryRow("PRAGMA page_size").Scan(&pageSize)

	sizeBytes := pageCount * pageSize

	// Collect table names first, close rows before querying counts
	// (avoids deadlock when MaxOpenConns=1 and rows are still open).
	var tableNames []string
	if rows, err := t.DB.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"); err == nil {
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err == nil {
				tableNames = append(tableNames, name)
			}
		}
		rows.Close()
	}
	tables := []map[string]any{}
	for _, name := range tableNames {
		var count int
		_ = t.DB.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM \"%s\"", name)).Scan(&count)
		tables = append(tables, map[string]any{
			"name":      name,
			"row_count": count,
		})
	}

	return map[string]any{
		"integrity":  integrity,
		"pages":      pageCount,
		"free_pages": freePages,
		"page_size":  pageSize,
		"size_bytes": sizeBytes,
		"tables":     tables,
	}, nil
}
