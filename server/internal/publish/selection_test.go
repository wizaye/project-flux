package publish

import "testing"

func TestSelectionPrecedenceAndPrivacy(t *testing.T) {
	yes, no := true, false
	config := SelectionConfig{
		Include: []string{"public/**", "**/*.release.md"},
		Exclude: []string{"public/private/**", "**/*.draft.md"},
	}
	tests := []struct {
		name        string
		path        string
		explicit    bool
		frontmatter *bool
		published   bool
		reason      string
	}{
		{"include", "public/note.md", false, nil, true, "included"},
		{"recursive include", "notes/v1/changelog.release.md", false, nil, true, "included"},
		{"exclude beats explicit", "public/private/note.md", true, &yes, false, "excluded"},
		{"frontmatter deny beats explicit", "public/note.md", true, &no, false, "frontmatter-deny"},
		{"hard exclusion beats allow", ".flux/private.md", true, &yes, false, "hard-excluded"},
		{"nested internal directory", "public/.git/config.md", true, &yes, false, "hard-excluded"},
		{"editor temporary file", "public/note.md.swp", true, &yes, false, "hard-excluded"},
		{"default private", "notes/private.md", false, nil, false, "default"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := Select(test.path, test.explicit, test.frontmatter, config)
			if got.Published != test.published || got.Reason != test.reason {
				t.Fatalf("Select() = %#v, want published=%v reason=%q", got, test.published, test.reason)
			}
		})
	}
}

func TestInvalidPatternFailsClosed(t *testing.T) {
	got := Select("public/note.md", true, nil, SelectionConfig{Exclude: []string{"[broken"}})
	if got.Published || got.Reason != "invalid-config" {
		t.Fatalf("Select() = %#v, want fail-closed invalid config", got)
	}
}
