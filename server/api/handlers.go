package api

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/GoCodeAlone/ratchet/agent"
	"github.com/GoCodeAlone/ratchet/comms"
	"github.com/GoCodeAlone/ratchet/task"
)

// Handlers bundles all REST API handler dependencies.
type Handlers struct {
	Agents  AgentManager
	Tasks   task.Store
	Bus     comms.Bus
	Logger  *slog.Logger
	Version string
	StartAt int64 // unix timestamp of server start
}

// RegisterRoutes registers all API routes on the given mux.
func (h *Handlers) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/agents", h.listAgents)
	mux.HandleFunc("POST /api/agents", h.createAgent)
	mux.HandleFunc("GET /api/agents/{id}", h.getAgent)
	mux.HandleFunc("POST /api/agents/{id}/start", h.startAgent)
	mux.HandleFunc("POST /api/agents/{id}/stop", h.stopAgent)

	mux.HandleFunc("GET /api/tasks", h.listTasks)
	mux.HandleFunc("POST /api/tasks", h.createTask)
	mux.HandleFunc("GET /api/tasks/{id}", h.getTask)
	mux.HandleFunc("PATCH /api/tasks/{id}", h.updateTask)

	mux.HandleFunc("GET /api/teams", h.listTeams)

	mux.HandleFunc("GET /api/messages", h.listMessages)

	mux.HandleFunc("GET /api/status", h.status)
	mux.HandleFunc("GET /api/version", h.version)
}

// writeJSON encodes v as JSON and writes it with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError writes a JSON error response.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// --- Agent handlers ---

func (h *Handlers) listAgents(w http.ResponseWriter, _ *http.Request) {
	agents := h.Agents.ListAgents()
	if agents == nil {
		agents = []agent.Info{}
	}
	writeJSON(w, http.StatusOK, agents)
}

func (h *Handlers) createAgent(w http.ResponseWriter, r *http.Request) {
	var cfg agent.Config
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if err := h.Agents.CreateAgent(cfg); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *Handlers) getAgent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	info, ok := h.Agents.GetAgent(id)
	if !ok {
		writeError(w, http.StatusNotFound, "agent not found")
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (h *Handlers) startAgent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.Agents.StartAgent(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) stopAgent(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := h.Agents.StopAgent(id); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- Task handlers ---

func (h *Handlers) listTasks(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	filter := task.Filter{}

	if s := q.Get("status"); s != "" {
		st := task.Status(s)
		filter.Status = &st
	}
	if a := q.Get("assigned_to"); a != "" {
		filter.AssignedTo = a
	}
	if t := q.Get("team_id"); t != "" {
		filter.TeamID = t
	}
	if l := q.Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil {
			filter.Limit = n
		}
	}
	if o := q.Get("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil {
			filter.Offset = n
		}
	}

	tasks, err := h.Tasks.List(filter)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tasks == nil {
		tasks = []*task.Task{}
	}
	writeJSON(w, http.StatusOK, tasks)
}

func (h *Handlers) createTask(w http.ResponseWriter, r *http.Request) {
	var t task.Task
	if err := json.NewDecoder(r.Body).Decode(&t); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	id, err := h.Tasks.Create(&t)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	t.ID = id
	writeJSON(w, http.StatusCreated, t)
}

func (h *Handlers) getTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	t, err := h.Tasks.Get(id)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "task not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, t)
}

func (h *Handlers) updateTask(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	existing, err := h.Tasks.Get(id)
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			writeError(w, http.StatusNotFound, "task not found")
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Decode partial update over existing task
	if err := json.NewDecoder(r.Body).Decode(existing); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	existing.ID = id // ensure ID is not overwritten

	if err := h.Tasks.Update(existing); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, existing)
}

// --- Team handlers ---

func (h *Handlers) listTeams(w http.ResponseWriter, _ *http.Request) {
	teams := h.Agents.ListTeams()
	if teams == nil {
		teams = []TeamInfo{}
	}
	writeJSON(w, http.StatusOK, teams)
}

// --- Message handlers ---

func (h *Handlers) listMessages(w http.ResponseWriter, r *http.Request) {
	agentID := r.URL.Query().Get("agent_id")
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil {
			limit = n
		}
	}

	msgs, err := h.Bus.History(agentID, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if msgs == nil {
		msgs = []*comms.Message{}
	}
	writeJSON(w, http.StatusOK, msgs)
}

// --- Status / version ---

func (h *Handlers) status(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "ok",
		"version": h.Version,
	})
}

// StatusHandler returns the status handler function for external registration.
func (h *Handlers) StatusHandler() http.HandlerFunc {
	return h.status
}

func (h *Handlers) version(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{
		"version": h.Version,
	})
}
