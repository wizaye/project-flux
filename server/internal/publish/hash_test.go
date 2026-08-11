package publish

import "testing"

func TestSnapshotHashIsOrderIndependent(t *testing.T) {
	hash := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	input := SnapshotHashInput{
		SchemaVersion:    1,
		PublicationName:  "Garden",
		PublicationTitle: "Garden",
		Selection: SelectionConfig{
			Include: []string{"research/**", "notes/**"},
			Exclude: []string{"private/**", "**/*.draft.md"},
		},
		Pages:             []ContentDigest{{Path: "pages/b.md", Hash: hash}, {Path: "pages/a.md", Hash: hash}},
		Assets:            []ContentDigest{{Path: "assets/z.png", Hash: hash}},
		SemanticGraphHash: hash,
	}
	first, err := SnapshotHash(input)
	if err != nil {
		t.Fatal(err)
	}
	input.Selection.Include[0], input.Selection.Include[1] = input.Selection.Include[1], input.Selection.Include[0]
	input.Pages[0], input.Pages[1] = input.Pages[1], input.Pages[0]
	second, err := SnapshotHash(input)
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("SnapshotHash changed with input order: %s != %s", first, second)
	}
	input.PublicationTitle = "Renamed garden"
	renamed, err := SnapshotHash(input)
	if err != nil || renamed == first {
		t.Fatalf("SnapshotHash ignored public site title: %s, %v", renamed, err)
	}
}

func TestSnapshotHashRejectsPrivatePath(t *testing.T) {
	hash := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	_, err := SnapshotHash(SnapshotHashInput{
		SchemaVersion:     1,
		Pages:             []ContentDigest{{Path: ".flux/private.md", Hash: hash}},
		SemanticGraphHash: hash,
	})
	if err == nil {
		t.Fatal("SnapshotHash accepted private path")
	}
}
