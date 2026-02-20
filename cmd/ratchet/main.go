// Command ratchet is the Ratchet CLI client.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/GoCodeAlone/ratchet/internal/version"
)

const defaultServer = "http://localhost:9090"

func main() {
	var (
		serverURL = flag.String("server", defaultServer, "ratchet server URL")
		token     = flag.String("token", os.Getenv("RATCHET_TOKEN"), "JWT auth token")
	)
	flag.Usage = usage
	flag.Parse()

	args := flag.Args()
	if len(args) == 0 {
		usage()
		os.Exit(1)
	}

	cli := &Client{
		BaseURL:    strings.TrimRight(*serverURL, "/"),
		Token:      *token,
		HTTPClient: &http.Client{Timeout: 15 * time.Second},
	}

	cmd := args[0]
	rest := args[1:]

	var err error
	switch cmd {
	case "version":
		err = cmdVersion(rest)
	case "status":
		err = cli.cmdStatus(rest)
	case "agents":
		err = cli.cmdAgents(rest)
	case "agent":
		err = cli.cmdAgent(rest)
	case "tasks":
		err = cli.cmdTasks(rest)
	case "task":
		err = cli.cmdTask(rest)
	case "serve":
		fmt.Fprintln(os.Stderr, "use ratchetd to run the server, or `make dev`")
		os.Exit(1)
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n", cmd)
		usage()
		os.Exit(1)
	}

	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `ratchet — Ratchet CLI

Usage:
  ratchet [flags] <command> [args]

Flags:
  --server  <url>    server URL (default: http://localhost:9090)
  --token   <token>  JWT auth token (or $RATCHET_TOKEN)

Commands:
  version              print version
  status               show server status
  agents               list agents
  agent start <id>     start an agent
  agent stop <id>      stop an agent
  tasks                list tasks
  task create <title>  create a task
`)
}

// --- version ---

func cmdVersion(_ []string) error {
	fmt.Printf("ratchet %s (commit %s, built %s)\n",
		version.Version, version.Commit, version.BuildDate)
	return nil
}

// Client holds HTTP client state for CLI commands.
type Client struct {
	BaseURL    string
	Token      string
	HTTPClient *http.Client
}

// get performs a GET and decodes JSON into v.
func (c *Client) get(path string, v any) error {
	req, err := http.NewRequest(http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return err
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

// post performs a POST and decodes JSON response into v (may be nil).
func (c *Client) post(path string, body io.Reader, v any) error {
	req, err := http.NewRequest(http.MethodPost, c.BaseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server returned %d: %s", resp.StatusCode, strings.TrimSpace(string(b)))
	}
	if v != nil && resp.ContentLength != 0 {
		return json.NewDecoder(resp.Body).Decode(v)
	}
	return nil
}

// --- status ---

func (c *Client) cmdStatus(_ []string) error {
	var result map[string]string
	if err := c.get("/api/status", &result); err != nil {
		return err
	}
	fmt.Printf("status:  %s\n", result["status"])
	fmt.Printf("version: %s\n", result["version"])
	return nil
}

// --- agents ---

func (c *Client) cmdAgents(_ []string) error {
	var agents []map[string]any
	if err := c.get("/api/agents", &agents); err != nil {
		return err
	}
	if len(agents) == 0 {
		fmt.Println("no agents")
		return nil
	}
	fmt.Printf("%-20s %-20s %-12s %-8s\n", "ID", "NAME", "STATUS", "LEAD")
	fmt.Println(strings.Repeat("-", 65))
	for _, a := range agents {
		id := strVal(a["id"])
		name := strVal(a["name"])
		status := strVal(a["status"])
		isLead := fmt.Sprint(a["is_lead"])
		fmt.Printf("%-20s %-20s %-12s %-8s\n", id, name, status, isLead)
	}
	return nil
}

// --- agent subcommands ---

func (c *Client) cmdAgent(args []string) error {
	if len(args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: ratchet agent <start|stop> <id>")
		os.Exit(1)
	}
	sub, id := args[0], args[1]
	switch sub {
	case "start":
		if err := c.post("/api/agents/"+id+"/start", nil, nil); err != nil {
			return err
		}
		fmt.Printf("agent %s started\n", id)
	case "stop":
		if err := c.post("/api/agents/"+id+"/stop", nil, nil); err != nil {
			return err
		}
		fmt.Printf("agent %s stopped\n", id)
	default:
		return fmt.Errorf("unknown agent subcommand: %s", sub)
	}
	return nil
}

// --- tasks ---

func (c *Client) cmdTasks(_ []string) error {
	var tasks []map[string]any
	if err := c.get("/api/tasks", &tasks); err != nil {
		return err
	}
	if len(tasks) == 0 {
		fmt.Println("no tasks")
		return nil
	}
	fmt.Printf("%-36s %-30s %-12s\n", "ID", "TITLE", "STATUS")
	fmt.Println(strings.Repeat("-", 82))
	for _, t := range tasks {
		fmt.Printf("%-36s %-30s %-12s\n",
			strVal(t["id"]),
			truncate(strVal(t["title"]), 29),
			strVal(t["status"]),
		)
	}
	return nil
}

// --- task subcommands ---

func (c *Client) cmdTask(args []string) error {
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "usage: ratchet task <create> <title>")
		os.Exit(1)
	}
	sub := args[0]
	switch sub {
	case "create":
		if len(args) < 2 {
			return fmt.Errorf("usage: ratchet task create <title>")
		}
		title := strings.Join(args[1:], " ")
		body := fmt.Sprintf(`{"title":%q,"status":"pending","priority":1}`, title)
		var result map[string]any
		if err := c.post("/api/tasks", strings.NewReader(body), &result); err != nil {
			return err
		}
		fmt.Printf("created task %s\n", strVal(result["id"]))
	default:
		return fmt.Errorf("unknown task subcommand: %s", sub)
	}
	return nil
}

// --- helpers ---

func strVal(v any) string {
	if v == nil {
		return ""
	}
	return fmt.Sprint(v)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}
