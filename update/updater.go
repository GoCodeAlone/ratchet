// Package update provides self-update functionality using GitHub releases.
package update

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

// Release describes a GitHub release with the download URL for the current platform.
type Release struct {
	Version string `json:"version"`
	URL     string `json:"url"`
}

// githubRelease is the subset of the GitHub releases API response we use.
type githubRelease struct {
	TagName string        `json:"tag_name"`
	Assets  []githubAsset `json:"assets"`
}

type githubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// Updater checks for and applies self-updates from GitHub releases.
type Updater struct {
	CurrentVersion string
	RepoOwner      string
	RepoName       string
	httpClient     *http.Client
}

// New returns an Updater configured for the GoCodeAlone/ratchet repository.
func New(currentVersion string) *Updater {
	return &Updater{
		CurrentVersion: currentVersion,
		RepoOwner:      "GoCodeAlone",
		RepoName:       "ratchet",
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// CheckForUpdate queries the GitHub releases API for the latest release.
// Returns nil, nil when already on the latest version.
func (u *Updater) CheckForUpdate() (*Release, error) {
	url := fmt.Sprintf(
		"https://api.github.com/repos/%s/%s/releases/latest",
		u.RepoOwner, u.RepoName,
	)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", fmt.Sprintf("ratchet/%s", u.CurrentVersion))

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch latest release: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github API returned %d", resp.StatusCode)
	}

	var rel githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return nil, fmt.Errorf("decode release: %w", err)
	}

	latest := strings.TrimPrefix(rel.TagName, "v")
	current := strings.TrimPrefix(u.CurrentVersion, "v")

	if latest == current || u.CurrentVersion == "dev" {
		return nil, nil // already up to date (or dev build)
	}

	dlURL := u.platformAssetURL(rel.Assets)
	if dlURL == "" {
		return nil, fmt.Errorf("no asset found for %s/%s", runtime.GOOS, runtime.GOARCH)
	}

	return &Release{
		Version: rel.TagName,
		URL:     dlURL,
	}, nil
}

// platformAssetURL finds the download URL matching the current OS and architecture.
func (u *Updater) platformAssetURL(assets []githubAsset) string {
	goos := runtime.GOOS
	goarch := runtime.GOARCH
	// Map goarch aliases
	if goarch == "amd64" {
		goarch = "x86_64"
	}

	for _, a := range assets {
		name := strings.ToLower(a.Name)
		if strings.Contains(name, goos) && strings.Contains(name, goarch) {
			return a.BrowserDownloadURL
		}
	}
	return ""
}

// ApplyUpdate downloads the release binary and replaces the running executable.
func (u *Updater) ApplyUpdate(release *Release) error {
	// Determine current executable path
	exe, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate executable: %w", err)
	}

	// Download to a temp file in the same directory as the executable
	tmpFile, err := os.CreateTemp("", "ratchet-update-*")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer func() {
		tmpFile.Close()    //nolint:errcheck
		os.Remove(tmpPath) //nolint:errcheck
	}()

	resp, err := u.httpClient.Get(release.URL) //nolint:noctx
	if err != nil {
		return fmt.Errorf("download release: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download returned %d", resp.StatusCode)
	}

	if _, err := io.Copy(tmpFile, resp.Body); err != nil {
		return fmt.Errorf("write download: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("close temp file: %w", err)
	}

	// Make executable
	if err := os.Chmod(tmpPath, 0o755); err != nil {
		return fmt.Errorf("chmod: %w", err)
	}

	// Replace the running binary
	if err := os.Rename(tmpPath, exe); err != nil {
		return fmt.Errorf("replace binary: %w", err)
	}

	return nil
}
