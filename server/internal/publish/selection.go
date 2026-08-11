package publish

import (
	"errors"
	"path"
	"strings"

	"github.com/flux-pkm/server/internal/files"
)

type SelectionConfig struct {
	DefaultPublic bool     `json:"defaultPublic"`
	Include       []string `json:"include"`
	Exclude       []string `json:"exclude"`
}

type SelectionDecision struct {
	Published bool
	Reason    string
}

func Select(relativePath string, explicitlySelected bool, frontmatterPublish *bool, config SelectionConfig) SelectionDecision {
	if ValidateSelectionConfig(config) != nil {
		return SelectionDecision{Reason: "invalid-config"}
	}
	normalized, err := files.NormalizePath(relativePath)
	if err != nil || hardExcluded(normalized) {
		return SelectionDecision{Reason: "hard-excluded"}
	}
	if frontmatterPublish != nil && !*frontmatterPublish {
		return SelectionDecision{Reason: "frontmatter-deny"}
	}
	if matchesAny(config.Exclude, normalized) {
		return SelectionDecision{Reason: "excluded"}
	}
	if explicitlySelected {
		return SelectionDecision{Published: true, Reason: "explicit"}
	}
	if frontmatterPublish != nil && *frontmatterPublish {
		return SelectionDecision{Published: true, Reason: "frontmatter"}
	}
	if matchesAny(config.Include, normalized) {
		return SelectionDecision{Published: true, Reason: "included"}
	}
	return SelectionDecision{Published: config.DefaultPublic, Reason: "default"}
}

func ValidateSelectionConfig(config SelectionConfig) error {
	if !validPatterns(config.Include) || !validPatterns(config.Exclude) {
		return errors.New("invalid publication selection pattern")
	}
	return nil
}

func validPatterns(patterns []string) bool {
	for _, pattern := range patterns {
		normalized := path.Clean(strings.ReplaceAll(pattern, "\\", "/"))
		if pattern == "" || path.IsAbs(normalized) || normalized == ".." || strings.HasPrefix(normalized, "../") {
			return false
		}
		for _, segment := range strings.Split(normalized, "/") {
			if segment != "**" {
				if _, err := path.Match(segment, ""); err != nil {
					return false
				}
			}
		}
	}
	return true
}

func hardExcluded(relativePath string) bool {
	if files.IsIgnored(relativePath) {
		return true
	}
	name := path.Base(relativePath)
	return name == ".DS_Store" || strings.HasSuffix(name, "~") ||
		strings.HasSuffix(name, ".swp") || strings.HasSuffix(name, ".swo") ||
		strings.HasPrefix(name, ".#")
}

func matchesAny(patterns []string, relativePath string) bool {
	for _, pattern := range patterns {
		if matchGlob(strings.Split(path.Clean(strings.ReplaceAll(pattern, "\\", "/")), "/"), strings.Split(relativePath, "/")) {
			return true
		}
	}
	return false
}

func matchGlob(pattern, value []string) bool {
	if len(pattern) == 0 {
		return len(value) == 0
	}
	if pattern[0] == "**" {
		return matchGlob(pattern[1:], value) || len(value) > 0 && matchGlob(pattern, value[1:])
	}
	matched, err := path.Match(pattern[0], first(value))
	return err == nil && len(value) > 0 && matched && matchGlob(pattern[1:], value[1:])
}

func first(items []string) string {
	if len(items) == 0 {
		return ""
	}
	return items[0]
}
