package task

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	_ "modernc.org/sqlite" // SQLite driver
)

const schema = `
CREATE TABLE IF NOT EXISTS tasks (
	id           TEXT PRIMARY KEY,
	title        TEXT NOT NULL,
	description  TEXT NOT NULL,
	status       TEXT NOT NULL,
	priority     INTEGER NOT NULL DEFAULT 1,
	assigned_to  TEXT NOT NULL DEFAULT '',
	team_id      TEXT NOT NULL DEFAULT '',
	parent_id    TEXT NOT NULL DEFAULT '',
	depends_on   TEXT NOT NULL DEFAULT '[]',
	labels       TEXT NOT NULL DEFAULT '[]',
	metadata     TEXT NOT NULL DEFAULT '{}',
	result       TEXT NOT NULL DEFAULT '',
	error        TEXT NOT NULL DEFAULT '',
	created_at   DATETIME NOT NULL,
	updated_at   DATETIME NOT NULL,
	started_at   DATETIME,
	completed_at DATETIME
);
`

// SQLiteStore persists tasks in a SQLite database.
type SQLiteStore struct {
	db *sql.DB
}

// NewSQLiteStore opens (or creates) a SQLite database at dbPath and ensures
// the tasks table exists. The caller is responsible for calling Close.
func NewSQLiteStore(dbPath string) (*SQLiteStore, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite %s: %w", dbPath, err)
	}
	db.SetMaxOpenConns(1) // prevent SQLITE_BUSY
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("create schema: %w", err)
	}
	return &SQLiteStore{db: db}, nil
}

// Close releases the underlying database connection.
func (s *SQLiteStore) Close() error { return s.db.Close() }

// newID generates a random hex UUID.
func newID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// Create persists a new task and sets its ID, CreatedAt, and UpdatedAt.
func (s *SQLiteStore) Create(t *Task) (string, error) {
	id, err := newID()
	if err != nil {
		return "", fmt.Errorf("generate id: %w", err)
	}
	t.ID = id
	now := time.Now().UTC()
	t.CreatedAt = now
	t.UpdatedAt = now

	dependsOn, _ := json.Marshal(t.DependsOn)
	labels, _ := json.Marshal(t.Labels)
	metadata, _ := json.Marshal(t.Metadata)

	_, err = s.db.Exec(`
		INSERT INTO tasks
			(id, title, description, status, priority, assigned_to, team_id, parent_id,
			 depends_on, labels, metadata, result, error, created_at, updated_at, started_at, completed_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		t.ID, t.Title, t.Description, string(t.Status), int(t.Priority),
		t.AssignedTo, t.TeamID, t.ParentID,
		string(dependsOn), string(labels), string(metadata),
		t.Result, t.Error,
		t.CreatedAt, t.UpdatedAt,
		nullTime(t.StartedAt), nullTime(t.CompletedAt),
	)
	if err != nil {
		return "", fmt.Errorf("insert task: %w", err)
	}
	return id, nil
}

// Get retrieves a task by ID.
func (s *SQLiteStore) Get(id string) (*Task, error) {
	row := s.db.QueryRow(`SELECT * FROM tasks WHERE id = ?`, id)
	t, err := scanTask(row)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("task %s not found", id)
	}
	return t, err
}

// Update saves changes to an existing task, updating UpdatedAt automatically.
func (s *SQLiteStore) Update(t *Task) error {
	t.UpdatedAt = time.Now().UTC()
	dependsOn, _ := json.Marshal(t.DependsOn)
	labels, _ := json.Marshal(t.Labels)
	metadata, _ := json.Marshal(t.Metadata)

	res, err := s.db.Exec(`
		UPDATE tasks SET
			title=?, description=?, status=?, priority=?, assigned_to=?, team_id=?, parent_id=?,
			depends_on=?, labels=?, metadata=?, result=?, error=?,
			updated_at=?, started_at=?, completed_at=?
		WHERE id=?`,
		t.Title, t.Description, string(t.Status), int(t.Priority),
		t.AssignedTo, t.TeamID, t.ParentID,
		string(dependsOn), string(labels), string(metadata),
		t.Result, t.Error,
		t.UpdatedAt, nullTime(t.StartedAt), nullTime(t.CompletedAt),
		t.ID,
	)
	if err != nil {
		return fmt.Errorf("update task: %w", err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("task %s not found", t.ID)
	}
	return nil
}

// List returns tasks matching the filter.
func (s *SQLiteStore) List(filter Filter) ([]*Task, error) {
	q := strings.Builder{}
	q.WriteString("SELECT * FROM tasks WHERE 1=1")
	args := []any{}

	if filter.Status != nil {
		q.WriteString(" AND status=?")
		args = append(args, string(*filter.Status))
	}
	if filter.AssignedTo != "" {
		q.WriteString(" AND assigned_to=?")
		args = append(args, filter.AssignedTo)
	}
	if filter.TeamID != "" {
		q.WriteString(" AND team_id=?")
		args = append(args, filter.TeamID)
	}
	if filter.ParentID != "" {
		q.WriteString(" AND parent_id=?")
		args = append(args, filter.ParentID)
	}
	q.WriteString(" ORDER BY priority DESC, created_at ASC")
	if filter.Limit > 0 {
		q.WriteString(fmt.Sprintf(" LIMIT %d", filter.Limit))
		if filter.Offset > 0 {
			q.WriteString(fmt.Sprintf(" OFFSET %d", filter.Offset))
		}
	}

	rows, err := s.db.Query(q.String(), args...)
	if err != nil {
		return nil, fmt.Errorf("list tasks: %w", err)
	}
	defer rows.Close()

	var tasks []*Task
	for rows.Next() {
		t, err := scanTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, t)
	}
	return tasks, rows.Err()
}

// Delete removes a task by ID.
func (s *SQLiteStore) Delete(id string) error {
	res, err := s.db.Exec("DELETE FROM tasks WHERE id=?", id)
	if err != nil {
		return fmt.Errorf("delete task: %w", err)
	}
	rows, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("task %s not found", id)
	}
	return nil
}

// scanner abstracts sql.Row and sql.Rows for scanTask.
type scanner interface {
	Scan(dest ...any) error
}

func scanTask(s scanner) (*Task, error) {
	var t Task
	var status, dependsOnJSON, labelsJSON, metadataJSON string
	var priority int
	var startedAt, completedAt sql.NullTime

	err := s.Scan(
		&t.ID, &t.Title, &t.Description, &status, &priority,
		&t.AssignedTo, &t.TeamID, &t.ParentID,
		&dependsOnJSON, &labelsJSON, &metadataJSON,
		&t.Result, &t.Error,
		&t.CreatedAt, &t.UpdatedAt,
		&startedAt, &completedAt,
	)
	if err != nil {
		return nil, err
	}

	t.Status = Status(status)
	t.Priority = Priority(priority)

	_ = json.Unmarshal([]byte(dependsOnJSON), &t.DependsOn)
	_ = json.Unmarshal([]byte(labelsJSON), &t.Labels)
	_ = json.Unmarshal([]byte(metadataJSON), &t.Metadata)

	if startedAt.Valid {
		t.StartedAt = &startedAt.Time
	}
	if completedAt.Valid {
		t.CompletedAt = &completedAt.Time
	}
	return &t, nil
}

func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}
