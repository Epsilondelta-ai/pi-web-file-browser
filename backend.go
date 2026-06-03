package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

const maxDepth = 12

type request map[string]any

type fileNode struct {
	Type     string     `json:"type"`
	Name     string     `json:"name"`
	Path     string     `json:"path"`
	Children []fileNode `json:"children,omitempty"`
}

type fileContent struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Size    int    `json:"size"`
	Mime    string `json:"mime"`
}

func main() {
	method := arg(1)
	root := arg(2)
	input, err := readInput(os.Stdin)
	if err != nil {
		fail(err)
	}
	if root == "" {
		fail(errors.New("workspace root is required"))
	}

	var result any
	switch method {
	case "list":
		files, err := listFiles(root)
		if err != nil {
			fail(err)
		}
		result = map[string]any{"files": files, "statusMap": gitStatus(root)}
	case "create":
		file, err := createFile(root, stringInput(input, "path"), stringInput(input, "content"))
		if err != nil {
			fail(err)
		}
		result = map[string]any{"file": file}
	case "read":
		file, err := readFile(root, stringInput(input, "path"))
		if err != nil {
			fail(err)
		}
		result = file
	case "write":
		file, err := writeFile(root, stringInput(input, "path"), stringInput(input, "content"))
		if err != nil {
			fail(err)
		}
		result = file
	default:
		fail(fmt.Errorf("unknown method: %s", method))
	}

	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fail(err)
	}
}

func arg(index int) string {
	if len(os.Args) <= index {
		return ""
	}
	return os.Args[index]
}

func readInput(reader io.Reader) (request, error) {
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return request{}, nil
	}
	var input request
	return input, json.Unmarshal(data, &input)
}

func stringInput(input request, key string) string {
	value, _ := input[key].(string)
	return value
}

func listFiles(root string) ([]fileNode, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	sortEntries(entries)
	files := make([]fileNode, 0, len(entries))
	for _, entry := range entries {
		if shouldIgnore(entry.Name()) {
			continue
		}
		node, err := nodeFor(root, entry.Name(), 0)
		if err == nil {
			files = append(files, node)
		}
	}
	return files, nil
}

func nodeFor(root, rel string, depth int) (fileNode, error) {
	info, err := os.Stat(filepath.Join(root, rel))
	if err != nil {
		return fileNode{}, err
	}
	name := filepath.Base(rel)
	if !info.IsDir() {
		return fileNode{Type: "file", Name: name, Path: slash(rel)}, nil
	}
	node := fileNode{Type: "dir", Name: name, Path: slash(rel)}
	if depth >= maxDepth {
		return node, nil
	}
	entries, err := os.ReadDir(filepath.Join(root, rel))
	if err != nil {
		return node, nil
	}
	sortEntries(entries)
	for _, entry := range entries {
		if shouldIgnore(entry.Name()) {
			continue
		}
		child, err := nodeFor(root, filepath.Join(rel, entry.Name()), depth+1)
		if err == nil {
			node.Children = append(node.Children, child)
		}
	}
	return node, nil
}

func sortEntries(entries []os.DirEntry) {
	sort.Slice(entries, func(i, j int) bool {
		leftDir := entries[i].IsDir()
		rightDir := entries[j].IsDir()
		if leftDir != rightDir {
			return leftDir
		}
		return strings.ToLower(entries[i].Name()) < strings.ToLower(entries[j].Name())
	})
}

func shouldIgnore(name string) bool {
	switch name {
	case ".git", "node_modules", "dist", "coverage", "storybook-static", "storybook-server", ".next", ".nuxt", ".turbo", ".cache":
		return true
	default:
		return false
	}
}

func createFile(root, rel, content string) (fileContent, error) {
	clean, err := cleanRel(rel)
	if err != nil {
		return fileContent{}, err
	}
	abs := filepath.Join(root, clean)
	if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
		return fileContent{}, err
	}
	file, err := os.OpenFile(abs, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return fileContent{}, err
	}
	defer file.Close()
	if _, err := file.WriteString(content); err != nil {
		return fileContent{}, err
	}
	return readFile(root, clean)
}

func readFile(root, rel string) (fileContent, error) {
	clean, err := cleanRel(rel)
	if err != nil {
		return fileContent{}, err
	}
	data, err := os.ReadFile(filepath.Join(root, clean))
	if err != nil {
		return fileContent{}, err
	}
	return fileContent{Path: slash(clean), Content: string(data), Size: len(data), Mime: mimeType(clean)}, nil
}

func writeFile(root, rel, content string) (fileContent, error) {
	clean, err := cleanRel(rel)
	if err != nil {
		return fileContent{}, err
	}
	if err := os.WriteFile(filepath.Join(root, clean), []byte(content), 0o644); err != nil {
		return fileContent{}, err
	}
	return readFile(root, clean)
}

func cleanRel(rel string) (string, error) {
	clean := filepath.Clean(strings.TrimLeft(rel, "/"))
	if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return "", errors.New("invalid file path")
	}
	return clean, nil
}

func mimeType(path string) string {
	if value := mime.TypeByExtension(filepath.Ext(path)); value != "" {
		return strings.Split(value, ";")[0]
	}
	return "text/plain"
}

func gitStatus(root string) map[string]string {
	cmd := exec.Command("git", "status", "--porcelain=v1", "-z")
	cmd.Dir = root
	output, err := cmd.Output()
	if err != nil {
		return map[string]string{}
	}
	status := map[string]string{}
	items := strings.Split(string(output), "\x00")
	for _, item := range items {
		if len(item) < 4 {
			continue
		}
		code := item[:2]
		path := item[3:]
		status[slash(path)] = statusName(code)
	}
	return status
}

func statusName(code string) string {
	if strings.Contains(code, "?") {
		return "untracked"
	}
	if strings.Contains(code, "A") {
		return "added"
	}
	if strings.Contains(code, "D") {
		return "deleted"
	}
	if strings.Contains(code, "R") {
		return "renamed"
	}
	return "modified"
}

func slash(path string) string {
	return filepath.ToSlash(path)
}

func fail(err error) {
	_, _ = fmt.Fprintln(os.Stderr, err.Error())
	os.Exit(1)
}
