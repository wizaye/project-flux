package publish

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"html/template"
	"os"
	"path/filepath"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/parser"
)

type renderedPage struct {
	Slug, Title, Description, HTML, SearchText string
	Tags                                       []string
	Backlinks                                  []renderedBacklink
}

type renderedBacklink struct{ Slug, Title string }

type siteTemplateData struct {
	Title     string
	PagesJSON template.JS
	Pages     []renderedPage
}

var siteTemplate = template.Must(template.New("site").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta id="description" name="description" content="{{.Title}}"><title>{{.Title}}</title><style>
:root{--bg:#f4f4f2;--panel:#fafaf9;--text:#20201e;--muted:#777771;--line:#dddcd8;--hover:#e9e8e4;--accent:#181817}@media(prefers-color-scheme:dark){:root{--bg:#151514;--panel:#1b1b1a;--text:#e7e7e4;--muted:#969690;--line:#30302e;--hover:#252523;--accent:#f0f0ec}}:root[data-theme=light]{--bg:#f4f4f2;--panel:#fafaf9;--text:#20201e;--muted:#777771;--line:#dddcd8;--hover:#e9e8e4;--accent:#181817}:root[data-theme=dark]{--bg:#151514;--panel:#1b1b1a;--text:#e7e7e4;--muted:#969690;--line:#30302e;--hover:#252523;--accent:#f0f0ec}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.65 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,select{font:inherit;color:inherit}.top{height:48px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;padding:0 18px;position:sticky;top:0;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(14px);z-index:2}.brand{font-weight:650;white-space:nowrap}.search{margin-left:auto;width:min(360px,45vw);border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:6px 10px;outline:none}.theme{border:1px solid var(--line);background:var(--panel);border-radius:8px;padding:5px 8px;outline:none}.layout{display:grid;grid-template-columns:240px minmax(0,760px) 220px;gap:32px;max-width:1320px;margin:auto;padding:28px}.rail{position:sticky;top:76px;max-height:calc(100vh - 96px);overflow:auto}.nav,.links{display:flex;flex-direction:column;gap:2px}.nav details{margin-left:8px}.nav summary{cursor:pointer;color:var(--muted);padding:5px 8px;list-style:none}.nav summary::before{content:'›';display:inline-block;width:14px;transition:transform .15s}.nav details[open]>summary::before{transform:rotate(90deg)}.nav a,.links a{display:block;color:var(--muted);text-decoration:none;padding:6px 8px;border-radius:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nav a:hover,.nav a[aria-current=true],.links a:hover{background:var(--hover);color:var(--text)}article{min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:clamp(24px,5vw,56px)}article h1{font-size:2rem;line-height:1.2;margin:0 0 24px}article h2{margin-top:2em}article img{max-width:100%;border-radius:8px}article pre{overflow:auto;background:var(--bg);border:1px solid var(--line);padding:14px;border-radius:8px}article code{font-family:ui-monospace,SFMono-Regular,monospace}article a{color:inherit;text-decoration-thickness:1px;text-underline-offset:3px}article blockquote{margin-left:0;padding-left:16px;border-left:2px solid var(--line);color:var(--muted)}article .callout{padding:12px 14px;border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;background:var(--bg);color:var(--text)}article .callout p{margin:0}.meta{color:var(--muted);font-size:12px}.right section+section{margin-top:24px}.right h2{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}.tags{display:flex;flex-wrap:wrap;gap:6px}.tag{border:1px solid var(--line);border-radius:99px;padding:2px 7px;color:var(--muted)}.empty{color:var(--muted);padding:80px 0;text-align:center}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:940px){.layout{grid-template-columns:190px minmax(0,1fr)}.right{display:none}}@media(max-width:680px){.top{height:auto;flex-wrap:wrap;padding:10px 14px}.search{order:3;width:100%}.layout{display:block;padding:14px}.left{position:static;max-height:none;margin-bottom:14px}.nav{max-height:220px;overflow:auto}article{padding:24px;border-radius:10px}}
</style></head><body><header class="top"><span class="brand">{{.Title}}</span><input id="search" class="search" type="search" placeholder="Search published notes" aria-label="Search published notes"><label class="sr-only" for="theme">Theme</label><select id="theme" class="theme" aria-label="Theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></header>
<div class="layout"><aside class="rail left"><nav id="nav" class="nav" aria-label="Published notes"></nav></aside><main id="main"></main><aside class="rail right"><section><h2>On this page</h2><nav id="toc" class="links"></nav></section><section><h2>Backlinks</h2><nav id="backlinks" class="links"></nav></section><section><h2>Tags</h2><div id="tags" class="tags"></div></section></aside></div>
<script type="application/json" id="pages">{{.PagesJSON}}</script><script>
const pages=JSON.parse(document.querySelector('#pages').textContent),main=document.querySelector('#main'),tags=document.querySelector('#tags'),toc=document.querySelector('#toc'),backlinks=document.querySelector('#backlinks'),nav=document.querySelector('#nav'),search=document.querySelector('#search'),theme=document.querySelector('#theme'),metaDescription=document.querySelector('#description');
function link(item){const el=document.createElement('a');el.href='#'+item.Slug;el.textContent=item.Title;return el}
function buildNav(){const root={folders:new Map,pages:[]};for(const page of pages){const parts=page.Slug.split('/').filter(Boolean);let node=root;for(const part of parts.slice(0,-1)){if(!node.folders.has(part))node.folders.set(part,{folders:new Map,pages:[]});node=node.folders.get(part)}node.pages.push(page)}const render=(node,target)=>{for(const page of node.pages.sort((a,b)=>a.Title.localeCompare(b.Title))){const el=link(page);el.dataset.search=page.SearchText;target.append(el)}for(const [name,child] of [...node.folders].sort((a,b)=>a[0].localeCompare(b[0]))){const details=document.createElement('details'),summary=document.createElement('summary');details.open=true;summary.textContent=name.replaceAll('-',' ');details.append(summary);render(child,details);target.append(details)}};render(root,nav)}
function show(){const slug=decodeURIComponent(location.hash.slice(1))||pages[0]?.Slug,p=pages.find(x=>x.Slug===slug)||pages[0];document.querySelectorAll('#nav a').forEach(a=>a.setAttribute('aria-current',String(a.getAttribute('href')==='#'+p?.Slug)));if(!p){main.innerHTML='<div class="empty">No published notes.</div>';return}main.innerHTML='<article><h1 id="page-title"></h1><p id="page-description" class="meta"></p><div id="page-content"></div></article>';document.querySelector('#page-title').textContent=p.Title;const description=document.querySelector('#page-description');description.textContent=p.Description;description.hidden=!p.Description;const content=document.querySelector('#page-content');content.innerHTML=p.HTML;content.querySelectorAll('blockquote').forEach(block=>{const first=block.querySelector('p'),match=first?.textContent.match(/^\[!(\w+)\]\s*(.*)/);if(!match)return;block.classList.add('callout');block.setAttribute('aria-label',match[1].toLowerCase()+' callout');first.textContent=match[2]||match[1]});tags.replaceChildren(...p.Tags.map(t=>{const el=document.createElement('span');el.className='tag';el.textContent=t;return el}));backlinks.replaceChildren(...p.Backlinks.map(link));toc.replaceChildren(...[...content.querySelectorAll('h2,h3')].map(h=>{const el=link({Slug:p.Slug,Title:h.textContent});el.addEventListener('click',e=>{e.preventDefault();h.scrollIntoView()});return el}));document.title=p.Title+' · {{.Title}}';metaDescription.content=p.Description||p.Title;window.scrollTo(0,0)}
function applyTheme(value){if(value==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=value;try{localStorage.setItem('flux-publish-theme',value)}catch{}}
try{theme.value=localStorage.getItem('flux-publish-theme')||'system'}catch{theme.value='system'}applyTheme(theme.value);theme.addEventListener('change',()=>applyTheme(theme.value));search.addEventListener('input',()=>{const q=search.value.trim().toLowerCase();nav.querySelectorAll('a').forEach(a=>a.hidden=q&&!a.dataset.search.includes(q));[...nav.querySelectorAll('details')].reverse().forEach(d=>{d.hidden=q&&![...d.querySelectorAll('a')].some(a=>!a.hidden);if(q&&!d.hidden)d.open=true})});addEventListener('hashchange',show);buildNav();show();
</script></body></html>`))

// RenderStaticSite consumes only the sanitized publication bundle.
func RenderStaticSite(snapshotPath string) (string, error) {
	manifestBytes, err := os.ReadFile(filepath.Join(snapshotPath, "manifest.json"))
	if err != nil {
		return "", err
	}
	var manifest PublicationManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return "", err
	}
	if err := validateManifest(manifest); err != nil {
		return "", err
	}
	markdown := goldmark.New(goldmark.WithExtensions(extension.GFM), goldmark.WithParserOptions(parser.WithAutoHeadingID()))
	backlinkBytes, err := os.ReadFile(filepath.Join(snapshotPath, filepath.FromSlash(manifest.Backlinks.Path)))
	if err != nil {
		return "", err
	}
	var backlinkIDs map[string][]string
	if err := json.Unmarshal(backlinkBytes, &backlinkIDs); err != nil {
		return "", err
	}
	pageByID := make(map[string]PublicationPage, len(manifest.Pages))
	for _, page := range manifest.Pages {
		pageByID[page.ID] = page
	}
	pages := make([]renderedPage, 0, len(manifest.Pages))
	for _, page := range manifest.Pages {
		source, err := os.ReadFile(filepath.Join(snapshotPath, filepath.FromSlash(page.ContentPath)))
		if err != nil {
			return "", err
		}
		var rendered bytes.Buffer
		if err := markdown.Convert(source, &rendered); err != nil {
			return "", err
		}
		renderedHTML := rendered.String()
		for _, asset := range manifest.Assets {
			content, err := os.ReadFile(filepath.Join(snapshotPath, filepath.FromSlash(asset.Path)))
			if err != nil {
				return "", err
			}
			mediaType := asset.MediaType
			if mediaType == "" {
				mediaType = "application/octet-stream"
			}
			dataURL := "data:" + mediaType + ";base64," + base64.StdEncoding.EncodeToString(content)
			renderedHTML = strings.ReplaceAll(renderedHTML, `src="`+asset.Path+`"`, `src="`+dataURL+`"`)
		}
		backlinks := make([]renderedBacklink, 0, len(backlinkIDs[page.ID]))
		for _, sourceID := range backlinkIDs[page.ID] {
			if source, ok := pageByID[sourceID]; ok {
				backlinks = append(backlinks, renderedBacklink{Slug: source.Slug, Title: source.Title})
			}
		}
		pages = append(pages, renderedPage{Slug: page.Slug, Title: page.Title, Description: page.Description, HTML: renderedHTML, SearchText: strings.ToLower(page.Title + " " + page.Description + " " + string(source)), Tags: page.Tags, Backlinks: backlinks})
	}
	jsonPages, err := json.Marshal(pages)
	if err != nil {
		return "", err
	}
	var site bytes.Buffer
	if err := siteTemplate.Execute(&site, siteTemplateData{Title: manifest.Publication.Title, Pages: pages, PagesJSON: template.JS(jsonPages)}); err != nil {
		return "", err
	}
	output := filepath.Join(snapshotPath, "site")
	temporary, err := os.MkdirTemp(snapshotPath, ".site-*")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(temporary)
	if err := os.WriteFile(filepath.Join(temporary, "index.html"), site.Bytes(), 0o600); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(temporary, "404.html"), site.Bytes(), 0o600); err != nil {
		return "", err
	}
	if err := os.WriteFile(filepath.Join(temporary, ".nojekyll"), nil, 0o600); err != nil {
		return "", err
	}
	if err := os.RemoveAll(output); err != nil {
		return "", err
	}
	if err := os.Rename(temporary, output); err != nil {
		return "", err
	}
	return output, nil
}

func validateManifest(manifest PublicationManifest) error {
	if manifest.SchemaVersion != 1 || manifest.Publication.ID == "" || manifest.Publication.Name == "" || manifest.Publication.Title == "" || !validHash(manifest.Snapshot.ID) || manifest.Snapshot.ID != manifest.Snapshot.ContentHash || !isSafePublicPath(manifest.Graph.Path) || !isSafePublicPath(manifest.Backlinks.Path) {
		return errors.New("invalid publication manifest")
	}
	ids, slugs := make(map[string]struct{}, len(manifest.Pages)), make(map[string]struct{}, len(manifest.Pages))
	for _, page := range manifest.Pages {
		if page.ID == "" || page.Title == "" || !validHash(page.ContentHash) || !isSafePublicPath(page.ContentPath) || !isSafePublicPath(page.OutputPath) {
			return errors.New("invalid publication page")
		}
		if _, exists := ids[page.ID]; exists {
			return errors.New("duplicate publication page id")
		}
		if _, exists := slugs[page.Slug]; exists {
			return errors.New("duplicate publication page slug")
		}
		ids[page.ID], slugs[page.Slug] = struct{}{}, struct{}{}
	}
	for _, asset := range manifest.Assets {
		if asset.ID == "" || !validHash(asset.ContentHash) || !isSafePublicPath(asset.Path) {
			return errors.New("invalid publication asset")
		}
	}
	return nil
}
