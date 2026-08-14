-- Wolf Forge Platform - authoritative SEO Sprint descriptions
-- Source: Wolf-Forge-SPP-Study/seo-sprints-descriptions.json
-- Source file SHA-256: 863f935855b6b123a45499dc98a29e48ce0b2bca3e4240314fe0c5cbd3779f3f
--
-- The UTF-8 capture is embedded as base64 so database resets reproduce the
-- exact HTML, emoji, punctuation, entities, and whitespace without depending
-- on the external study directory at runtime.

create or replace function private.seed_seo_sprints_catalog()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  folder_id constant uuid := '5e000000-0000-4000-8000-000000000001';
  capture constant jsonb := convert_from(
    decode(
      $seo_sprints_capture$
ewogICJmb2xkZXIiOiB7CiAgICAic291cmNlX2ZvbGRlcl9pZCI6IDU0LAogICAgIm5hbWUiOiAiU0VPIFNwcmludHMiLAogICAgInNlcnZpY2VfY291bnQi
OiAxMAogIH0sCiAgInNlcnZpY2VzIjogWwogICAgewogICAgICAic291cmNlX3NlcnZpY2VfaWQiOiA1NzEsCiAgICAgICJuYW1lIjogIk1BUFMgU1BSSU5U
IiwKICAgICAgImRlc2NyaXB0aW9uIjogIjxkaXY+8J+aqCA8c3Ryb25nPkFSRSBZT1UgQkVJTkcgRk9VTkQgT04gR09PR0xFIE1BUFM/PC9zdHJvbmc+PC9k
aXY+PGRpdj48YnI+WW91ciBjb21wZXRpdG9ycyBkb24ndCBuZWNlc3NhcmlseSBoYXZlIGEgYmV0dGVyIGJ1c2luZXNzLjxicj48YnI+PC9kaXY+PGRpdj48
YnI+VGhleSBtYXkgc2ltcGx5IGJlIDxzdHJvbmc+bW9yZSB2aXNpYmxlLjxicj48L3N0cm9uZz48YnI+PC9kaXY+PGRpdj48YnI+VGhlIFdvbGYgRm9yZ2Ug
PHN0cm9uZz5NYXBzIFNwcmludDwvc3Ryb25nPiBpcyBkZXNpZ25lZCB0byBpZGVudGlmeSB3aGF0J3MgaG9sZGluZyB5b3VyIEdvb2dsZSBNYXBzIHByZXNl
bmNlIGJhY2suPGJyPjxicj48L2Rpdj48ZGl2Pjxicj5XZSdsbCBhbmFseXplOjxicj48YnI+PC9kaXY+PGRpdj48YnI+4pyTIEdvb2dsZSBCdXNpbmVzcyBQ
cm9maWxlPGJyPiZuYnNwO+KckyBDYXRlZ29yaWVzICZhbXA7IHNlcnZpY2VzPGJyPiZuYnNwO+KckyBMb2NhbCBrZXl3b3Jkczxicj4mbmJzcDvinJMgR2Vv
Z3JhcGhpYyByZWxldmFuY2U8YnI+Jm5ic3A74pyTIE1hcHMgcmFua2luZ3M8YnI+Jm5ic3A74pyTIENvbXBldGl0b3IgcG9zaXRpb25pbmc8YnI+Jm5ic3A7
4pyTIE9wdGltaXphdGlvbiBvcHBvcnR1bml0aWVzPGJyPiZuYnNwO+KckyBQcmlvcml0eSBhY3Rpb24gcGxhbjxicj48YnI+PC9kaXY+PGRpdj48YnI+WW91
J2xsIGtub3cgPHN0cm9uZz53aGF0IG5lZWRzIHRvIGJlIGZpeGVkIGZpcnN0PC9zdHJvbmc+IHRvIGltcHJvdmUgeW91ciBsb2NhbCB2aXNpYmlsaXR5Ljxi
cj48YnI+PC9kaXY+PGRpdj48YnI+PGJyPjwvZGl2PiIKICAgIH0sCiAgICB7CiAgICAgICJzb3VyY2Vfc2VydmljZV9pZCI6IDU3MiwKICAgICAgIm5hbWUi
OiAiU0VPIFNQUklOVCIsCiAgICAgICJkZXNjcmlwdGlvbiI6ICI8ZGl2Pjxicj7wn5qoIDxzdHJvbmc+WU9VUiBDT01QRVRJVE9SUyBBUkUgUkFOS0lORy4g
V0hZIEFSRU4nVCBZT1U/PGJyPjwvc3Ryb25nPjxicj48L2Rpdj48ZGl2Pjxicj5JZiB5b3VyIHdlYnNpdGUgaXNuJ3QgcmFua2luZyBmb3IgdGhlIHNlYXJj
aGVzIHlvdXIgY3VzdG9tZXJzIGFyZSBtYWtpbmcsIHRoZXJlJ3MgYSByZWFzb24uPGJyPjxicj48L2Rpdj48ZGl2Pjxicj5UaGUgV29sZiBGb3JnZSA8c3Ry
b25nPlNFTyBTcHJpbnQ8L3N0cm9uZz4gaWRlbnRpZmllcyB0aGUgYmlnZ2VzdCBvcHBvcnR1bml0aWVzIGhvbGRpbmcgeW91ciB3ZWJzaXRlIGJhY2suPGJy
Pjxicj48L2Rpdj48ZGl2Pjxicj5XZSdsbCBhbmFseXplOjxicj48YnI+PC9kaXY+PGRpdj48YnI+4pyTIFdlYnNpdGUgU0VPPGJyPiZuYnNwO+KckyBLZXl3
b3JkIGdhcHM8YnI+Jm5ic3A74pyTIENvbXBldGl0b3IgcmFua2luZ3M8YnI+Jm5ic3A74pyTIE9uLXBhZ2UgU0VPPGJyPiZuYnNwO+KckyBUZWNobmljYWwg
U0VPPGJyPiZuYnNwO+KckyBDb250ZW50IG9wcG9ydHVuaXRpZXM8YnI+Jm5ic3A74pyTIEludGVybmFsIGxpbmtpbmc8YnI+Jm5ic3A74pyTIFByaW9yaXR5
IGZpeGVzPGJyPjxicj48L2Rpdj48ZGl2Pjxicj5Zb3UnbGwgcmVjZWl2ZSBhIGNsZWFyIHBpY3R1cmUgb2YgPHN0cm9uZz53aGVyZSB5b3UgYXJlLCB3aGF0
J3MgbWlzc2luZywgYW5kIHdoYXQgc2hvdWxkIGhhcHBlbiBuZXh0Ljxicj48L3N0cm9uZz48YnI+PC9kaXY+PGRpdj48YnI+PGJyPjwvZGl2PiIKICAgIH0s
CiAgICB7CiAgICAgICJzb3VyY2Vfc2VydmljZV9pZCI6IDU3MywKICAgICAgIm5hbWUiOiAiQUkgVklTSUJJTElUWSBTUFJJTlQiLAogICAgICAiZGVzY3Jp
cHRpb24iOiAiPGRpdj48YnI+8J+kliA8c3Ryb25nPldIRU4gQ1VTVE9NRVJTIEFTSyBBSSBBQk9VVCBZT1VSIElORFVTVFJZ4oCmPGJyPjwvc3Ryb25nPjxi
cj48L2Rpdj48ZGl2PjxzdHJvbmc+PGJyPkRPRVMgWU9VUiBCVVNJTkVTUyBTSE9XIFVQPzxicj48L3N0cm9uZz48YnI+PC9kaXY+PGRpdj48YnI+U2VhcmNo
IGlzIGNoYW5naW5nLjxicj48YnI+PC9kaXY+PGRpdj48YnI+Q3VzdG9tZXJzIGFyZSBpbmNyZWFzaW5nbHkgdXNpbmcgQUktcG93ZXJlZCBwbGF0Zm9ybXMg
dG8gZGlzY292ZXIgaW5mb3JtYXRpb24sIGJ1c2luZXNzZXMsIHByb2R1Y3RzIGFuZCBzZXJ2aWNlcy48YnI+PGJyPjwvZGl2PjxkaXY+PGJyPlRoZSBXb2xm
IEZvcmdlIDxzdHJvbmc+QUkgVmlzaWJpbGl0eSBTcHJpbnQ8L3N0cm9uZz4gaGVscHMgaWRlbnRpZnkgb3Bwb3J0dW5pdGllcyBmb3IgeW91ciBidXNpbmVz
cyB0byBiZWNvbWUgbW9yZSB2aXNpYmxlIGFjcm9zcyBBSS1kcml2ZW4gc2VhcmNoLjxicj48YnI+PC9kaXY+PGRpdj48YnI+V2UnbGwgYW5hbHl6ZTo8YnI+
PGJyPjwvZGl2PjxkaXY+PGJyPuKckyBBSSBzZWFyY2ggdmlzaWJpbGl0eTxicj4mbmJzcDvinJMgQ2hhdEdQVCBvcHBvcnR1bml0aWVzPGJyPiZuYnNwO+Kc
kyBHb29nbGUgQUkgb3Bwb3J0dW5pdGllczxicj4mbmJzcDvinJMgQUVPIG9wcG9ydHVuaXRpZXM8YnI+Jm5ic3A74pyTIEVudGl0eSAmYW1wOyBicmFuZCB2
aXNpYmlsaXR5PGJyPiZuYnNwO+KckyBDb250ZW50IGdhcHM8YnI+Jm5ic3A74pyTIFF1ZXJ5IG9wcG9ydHVuaXRpZXM8YnI+Jm5ic3A74pyTIEFJIHZpc2li
aWxpdHkgcm9hZG1hcDxicj48YnI+PC9kaXY+PGRpdj48YnI+RG9uJ3Qgd2FpdCB1bnRpbCB5b3VyIGNvbXBldGl0b3JzIGJlY29tZSB0aGUgYnVzaW5lc3Nl
cyBBSSByZWNvbW1lbmRzLjxicj48YnI+PC9kaXY+PGRpdj48YnI+PGJyPjwvZGl2PiIKICAgIH0sCiAgICB7CiAgICAgICJzb3VyY2Vfc2VydmljZV9pZCI6
IDU3NCwKICAgICAgIm5hbWUiOiAiV0VCU0lURSBTUFJJTlQiLAogICAgICAiZGVzY3JpcHRpb24iOiAiPGRpdj48YnI+8J+aqCA8c3Ryb25nPllPVVIgV0VC
U0lURSBTSE9VTEQgU0VMTC48YnI+PC9zdHJvbmc+PGJyPjwvZGl2PjxkaXY+PHN0cm9uZz48YnI+Tk9UIEpVU1QgRVhJU1QuPGJyPjwvc3Ryb25nPjxicj48
L2Rpdj48ZGl2Pjxicj5Zb3UgY2FuIGhhdmUgYSBiZWF1dGlmdWwgd2Vic2l0ZSBhbmQgc3RpbGwgbG9zZSBjdXN0b21lcnMuPGJyPjxicj48L2Rpdj48ZGl2
Pjxicj5UaGUgV29sZiBGb3JnZSA8c3Ryb25nPldlYnNpdGUgU3ByaW50PC9zdHJvbmc+IGlkZW50aWZpZXMgdGhlIHByb2JsZW1zIHRoYXQgbWF5IGJlIHN0
b3BwaW5nIHZpc2l0b3JzIGZyb20gYmVjb21pbmcgbGVhZHMuPGJyPjxicj48L2Rpdj48ZGl2Pjxicj5XZSdsbCBhbmFseXplOjxicj48YnI+PC9kaXY+PGRp
dj48YnI+4pyTIEhvbWVwYWdlIHN0cnVjdHVyZTxicj4mbmJzcDvinJMgTW9iaWxlIGV4cGVyaWVuY2U8YnI+Jm5ic3A74pyTIFBhZ2Ugc3BlZWQ8YnI+Jm5i
c3A74pyTIFNFTyBzdHJ1Y3R1cmU8YnI+Jm5ic3A74pyTIFNlcnZpY2UgcGFnZXM8YnI+Jm5ic3A74pyTIENhbGxzLXRvLWFjdGlvbjxicj4mbmJzcDvinJMg
VHJ1c3Qgc2lnbmFsczxicj4mbmJzcDvinJMgQ29udmVyc2lvbiBvcHBvcnR1bml0aWVzPGJyPiZuYnNwO+KckyBVc2VyIGV4cGVyaWVuY2U8YnI+PGJyPjwv
ZGl2PjxkaXY+PGJyPllvdSdsbCBnZXQgYSBjbGVhciByb2FkbWFwIHNob3dpbmcgPHN0cm9uZz53aGF0IG5lZWRzIGF0dGVudGlvbiBmaXJzdC48YnI+PC9z
dHJvbmc+PGJyPjwvZGl2PjxkaXY+PGJyPjxicj48L2Rpdj4iCiAgICB9LAogICAgewogICAgICAic291cmNlX3NlcnZpY2VfaWQiOiA1NzUsCiAgICAgICJu
YW1lIjogIkxFQUQgR0VOIFNQUklOVCIsCiAgICAgICJkZXNjcmlwdGlvbiI6ICI8ZGl2Pjxicj7wn5qoIDxzdHJvbmc+VFJBRkZJQyBJU04nVCBUSEUgR09B
TC48YnI+PC9zdHJvbmc+PGJyPjwvZGl2PjxkaXY+PHN0cm9uZz48YnI+TEVBRFMgQVJFLjxicj48L3N0cm9uZz48YnI+PC9kaXY+PGRpdj48YnI+WW91IGNh
biBoYXZlIHZpc2l0b3JzIGNvbWluZyB0byB5b3VyIHdlYnNpdGUgYW5kIHN0aWxsIGhhdmUgYSBicm9rZW4gbGVhZC1nZW5lcmF0aW9uIHN5c3RlbS48YnI+
PGJyPjwvZGl2PjxkaXY+PGJyPlRoZSBXb2xmIEZvcmdlIDxzdHJvbmc+TGVhZCBHZW4gU3ByaW50PC9zdHJvbmc+IGlkZW50aWZpZXMgd2hlcmUgcG90ZW50
aWFsIGN1c3RvbWVycyBhcmUgZmFsbGluZyBvdXQgb2YgeW91ciBsZWFkIHByb2Nlc3MuPGJyPjxicj48L2Rpdj48ZGl2Pjxicj5XZSdsbCBhbmFseXplOjxi
cj48YnI+PC9kaXY+PGRpdj48YnI+4pyTIExlYWQgZ2VuZXJhdGlvbiBzeXN0ZW08YnI+Jm5ic3A74pyTIE9mZmVyICZhbXA7IGxlYWQgbWFnbmV0PGJyPiZu
YnNwO+KckyBMYW5kaW5nIHBhZ2VzPGJyPiZuYnNwO+KckyBMZWFkIGNhcHR1cmU8YnI+Jm5ic3A74pyTIEZvcm1zICZhbXA7IGZ1bm5lbHM8YnI+Jm5ic3A7
4pyTIENSTSBvcHBvcnR1bml0aWVzPGJyPiZuYnNwO+KckyBMZWFkIHNvdXJjZXM8YnI+Jm5ic3A74pyTIEZvbGxvdy11cCBwcm9jZXNzPGJyPiZuYnNwO+Kc
kyBMZWFkIGZsb3c8YnI+PGJyPjwvZGl2PjxkaXY+PGJyPldlJ2xsIHNob3cgeW91IDxzdHJvbmc+d2hlcmUgdGhlIGxlYWtzIGFyZSBhbmQgd2hhdCB5b3Ug
c2hvdWxkIGZpeCBmaXJzdC48YnI+PC9zdHJvbmc+PGJyPjwvZGl2PjxkaXY+PGJyPjxicj48L2Rpdj4iCiAgICB9LAogICAgewogICAgICAic291cmNlX3Nl
cnZpY2VfaWQiOiA1NzYsCiAgICAgICJuYW1lIjogIkNPTlZFUlNJT04gU1BSSU5UIiwKICAgICAgImRlc2NyaXB0aW9uIjogIjxkaXY+PGJyPvCfmqggPHN0
cm9uZz5ZT1UnUkUgR0VUVElORyBMRUFEUy48YnI+PC9zdHJvbmc+PGJyPjwvZGl2PjxkaXY+PHN0cm9uZz48YnI+QlVUIEhPVyBNQU5ZIEFSRSBZT1UgTE9T
SU5HPzxicj48L3N0cm9uZz48YnI+PC9kaXY+PGRpdj48YnI+R2V0dGluZyBsZWFkcyBpcyBvbmx5IGhhbGYgdGhlIGJhdHRsZS48YnI+PGJyPjwvZGl2Pjxk
aXY+PGJyPklmIHlvdXIgd2Vic2l0ZSwgc2FsZXMgcHJvY2VzcywgZm9sbG93LXVwIG9yIG9mZmVyIGlzbid0IGNvbnZlcnRpbmcsIHlvdSdyZSBsZWF2aW5n
IHJldmVudWUgYmVoaW5kLjxicj48YnI+PC9kaXY+PGRpdj48YnI+VGhlIFdvbGYgRm9yZ2UgPHN0cm9uZz5Db252ZXJzaW9uIFNwcmludDwvc3Ryb25nPiBp
ZGVudGlmaWVzIHRoZSBsZWFrcyBiZXR3ZWVuIDxzdHJvbmc+bGVhZCDihpIgY3VzdG9tZXIuPGJyPjwvc3Ryb25nPjxicj48L2Rpdj48ZGl2Pjxicj5XZSds
bCBhbmFseXplOjxicj48YnI+PC9kaXY+PGRpdj48YnI+4pyTIFdlYnNpdGUgY29udmVyc2lvbjxicj4mbmJzcDvinJMgTGFuZGluZyBwYWdlczxicj4mbmJz
cDvinJMgQ2FsbHMtdG8tYWN0aW9uPGJyPiZuYnNwO+KckyBPZmZlciAmYW1wOyBtZXNzYWdpbmc8YnI+Jm5ic3A74pyTIFRydXN0IHNpZ25hbHM8YnI+Jm5i
c3A74pyTIENvbnRhY3QgZm9ybXM8YnI+Jm5ic3A74pyTIEZvbGxvdy11cDxicj4mbmJzcDvinJMgU2FsZXMgcHJvY2Vzczxicj4mbmJzcDvinJMgQ29udmVy
c2lvbiBvcHBvcnR1bml0aWVzPGJyPjxicj48L2Rpdj48ZGl2Pjxicj48YnI+PC9kaXY+IgogICAgfSwKICAgIHsKICAgICAgInNvdXJjZV9zZXJ2aWNlX2lk
IjogNTc3LAogICAgICAibmFtZSI6ICJDT01QRVRJVE9SIFNQUklOVCIsCiAgICAgICJkZXNjcmlwdGlvbiI6ICI8ZGl2Pjxicj7wn5SlIDxzdHJvbmc+WU9V
UiBDT01QRVRJVE9SUyBBUkUgV0lOTklORy48YnI+PC9zdHJvbmc+PGJyPjwvZGl2PjxkaXY+PHN0cm9uZz48YnI+RE8gWU9VIEtOT1cgV0hZPzxicj48L3N0
cm9uZz48YnI+PC9kaXY+PGRpdj48YnI+TW9zdCBidXNpbmVzcyBvd25lcnMgd2F0Y2ggdGhlaXIgY29tcGV0aXRvcnMuPGJyPjxicj48L2Rpdj48ZGl2Pjxi
cj5WZXJ5IGZldyBhY3R1YWxseSA8c3Ryb25nPmFuYWx5emUgdGhlbS48YnI+PC9zdHJvbmc+PGJyPjwvZGl2PjxkaXY+PGJyPlRoZSBXb2xmIEZvcmdlIDxz
dHJvbmc+Q29tcGV0aXRvciBTcHJpbnQ8L3N0cm9uZz4gZ2l2ZXMgeW91IGEgc3RyYXRlZ2ljIGxvb2sgYXQgd2hhdCdzIHdvcmtpbmcgZm9yIHRoZSBidXNp
bmVzc2VzIGNvbXBldGluZyBmb3IgeW91ciBjdXN0b21lcnMuPGJyPjxicj48L2Rpdj48ZGl2Pjxicj5XZSdsbCBhbmFseXplOjxicj48YnI+PC9kaXY+PGRp
dj48YnI+4pyTIFRvcCBjb21wZXRpdG9yczxicj4mbmJzcDvinJMgS2V5d29yZCByYW5raW5nczxicj4mbmJzcDvinJMgR29vZ2xlIE1hcHMgcG9zaXRpb25p
bmc8YnI+Jm5ic3A74pyTIFdlYnNpdGUgc3RyYXRlZ3k8YnI+Jm5ic3A74pyTIENvbnRlbnQ8YnI+Jm5ic3A74pyTIEF1dGhvcml0eTxicj4mbmJzcDvinJMg
T2ZmZXJzICZhbXA7IG1lc3NhZ2luZzxicj4mbmJzcDvinJMgTWFya2V0IGdhcHM8YnI+Jm5ic3A74pyTIEdyb3d0aCBvcHBvcnR1bml0aWVzPGJyPjxicj48
L2Rpdj48ZGl2Pjxicj5XZSdsbCBzaG93IHlvdSA8c3Ryb25nPndoZXJlIHRoZXkncmUgd2lubmluZ+KAlGFuZCB3aGVyZSB5b3UgY2FuIGF0dGFjay48YnI+
PC9zdHJvbmc+PGJyPjwvZGl2PjxkaXY+PGJyPjxicj48L2Rpdj4iCiAgICB9LAogICAgewogICAgICAic291cmNlX3NlcnZpY2VfaWQiOiA1NzksCiAgICAg
ICJuYW1lIjogIkxFQUQgR0VORVJBVElPTiBTWVNURU0iLAogICAgICAiZGVzY3JpcHRpb24iOiAiPGRpdj7wn5qoIDxzdHJvbmc+WU9VIERPTidUIEpVU1Qg
TkVFRCBNT1JFIFRSQUZGSUMuPGJyPjwvc3Ryb25nPjxicj48L2Rpdj48ZGl2PjxzdHJvbmc+WU9VIE5FRUQgQSBTWVNURU0gVEhBVCBUVVJOUyBBVFRFTlRJ
T04gSU5UTyBMRUFEUy48L3N0cm9uZz48L2Rpdj48ZGl2PkdldHRpbmcgcGVvcGxlIHRvIHlvdXIgd2Vic2l0ZSBpcyBvbmx5IHRoZSBiZWdpbm5pbmcuPGJy
Pjxicj48L2Rpdj48ZGl2PklmIHlvdSBkb24ndCBoYXZlIHRoZSByaWdodCBmdW5uZWwsIGxlYWQgY2FwdHVyZSwgZm9sbG93LXVwLCBDUk0sIGFuZCBhcHBv
aW50bWVudCBwcm9jZXNzIGluIHBsYWNlLCB2YWx1YWJsZSBvcHBvcnR1bml0aWVzIGNhbiBzbGlwIHRocm91Z2ggdGhlIGNyYWNrcy48YnI+PGJyPjwvZGl2
PjxkaXY+VGhhdCdzIHdoeSBXb2xmIEZvcmdlIGJ1aWx0IHRoZSA8c3Ryb25nPkxlYWQgR2VuZXJhdGlvbiBTeXN0ZW08L3N0cm9uZz4g4oCUIGEgY29tcGxl
dGUgbGVhZC1jYXB0dXJlIGFuZCBmb2xsb3ctdXAgaW5mcmFzdHJ1Y3R1cmUgZGVzaWduZWQgdG8gaGVscCB0dXJuIGludGVyZXN0ZWQgcHJvc3BlY3RzIGlu
dG8gPHN0cm9uZz5yZWFsIHNhbGVzIG9wcG9ydHVuaXRpZXMuPGJyPjwvc3Ryb25nPjxicj48L2Rpdj48ZGl2PvCflKUgV0UnTEwgQlVJTEQ6PC9kaXY+PGRp
dj7inJMgPHN0cm9uZz5MZWFkIEZ1bm5lbDwvc3Ryb25nPiDigJQgQ3JlYXRlIGEgY2xlYXIgcGF0aCBmcm9tIHZpc2l0b3IgdG8gbGVhZDxicj4g4pyTIDxz
dHJvbmc+TGFuZGluZyBQYWdlPC9zdHJvbmc+IOKAlCBCdWlsZCBhIGZvY3VzZWQgcGFnZSBkZXNpZ25lZCB0byBjYXB0dXJlIGF0dGVudGlvbjxicj4g4pyT
IDxzdHJvbmc+TGVhZCBGb3JtPC9zdHJvbmc+IOKAlCBNYWtlIGl0IGVhc3kgZm9yIHByb3NwZWN0cyB0byB0YWtlIHRoZSBuZXh0IHN0ZXA8YnI+IOKckyA8
c3Ryb25nPkNSTSBTZXR1cDwvc3Ryb25nPiDigJQgT3JnYW5pemUgYW5kIG1hbmFnZSB5b3VyIGluY29taW5nIGxlYWRzPGJyPiDinJMgPHN0cm9uZz5TYWxl
cyBQaXBlbGluZTwvc3Ryb25nPiDigJQgS25vdyBleGFjdGx5IHdoZXJlIGV2ZXJ5IHByb3NwZWN0IHN0YW5kczxicj4g4pyTIDxzdHJvbmc+QXV0b21hdGVk
IEZvbGxvdy1VcDwvc3Ryb25nPiDigJQgU3RheSBpbiBmcm9udCBvZiBsZWFkcyB3aXRob3V0IHJlbHlpbmcgb24gbWFudWFsIGZvbGxvdy11cDxicj4g4pyT
IDxzdHJvbmc+U01TICZhbXA7IEVtYWlsIFNlcXVlbmNlczwvc3Ryb25nPiDigJQgQnVpbGQgY29uc2lzdGVudCBjb21tdW5pY2F0aW9uIGFmdGVyIHRoZSBs
ZWFkIGNvbWVzIGluPGJyPiDinJMgPHN0cm9uZz5MZWFkIFJvdXRpbmc8L3N0cm9uZz4g4oCUIEdldCBsZWFkcyB0byB0aGUgcmlnaHQgcGVyc29uIHF1aWNr
bHk8YnI+IOKckyA8c3Ryb25nPkFwcG9pbnRtZW50IEJvb2tpbmc8L3N0cm9uZz4g4oCUIE1ha2UgaXQgZWFzaWVyIGZvciBwcm9zcGVjdHMgdG8gc2NoZWR1
bGU8YnI+IOKckyA8c3Ryb25nPkxlYWQgVHJhY2tpbmc8L3N0cm9uZz4g4oCUIFNlZSB3aGVyZSB5b3VyIG9wcG9ydHVuaXRpZXMgYXJlIGNvbWluZyBmcm9t
IGFuZCB3aGF0IGhhcHBlbnMgdG8gdGhlbTxicj48YnI+PC9kaXY+PGRpdj48c3Ryb25nPlN0b3AgcmVseWluZyBvbiBzY2F0dGVyZWQgZm9ybXMsIHNwcmVh
ZHNoZWV0cyBhbmQgbWFudWFsIGZvbGxvdy11cHMuPGJyPjwvc3Ryb25nPjxicj48L2Rpdj48ZGl2PkJ1aWxkIGEgc3lzdGVtIHRoYXQgZ2l2ZXMgZXZlcnkg
bGVhZCBhIGNsZWFyIHBhdGggZnJvbTo8YnI+PGJyPjwvZGl2PjxkaXY+PHN0cm9uZz5JTlRFUkVTVCDihpIgTEVBRCDihpIgRk9MTE9XLVVQIOKGkiBBUFBP
SU5UTUVOVCDihpIgQ1VTVE9NRVI8YnI+PC9zdHJvbmc+PGJyPjwvZGl2PiIKICAgIH0sCiAgICB7CiAgICAgICJzb3VyY2Vfc2VydmljZV9pZCI6IDU4MCwK
ICAgICAgIm5hbWUiOiAiQ29udmVyc2lvbiBPcHRpbWl6YXRpb24gU3lzdGVtIiwKICAgICAgImRlc2NyaXB0aW9uIjogIjxkaXY+8J+aqCA8c3Ryb25nPllP
VSBET04nVCBBTFdBWVMgTkVFRCBNT1JFIFRSQUZGSUMuPGJyPjwvc3Ryb25nPjxicj48L2Rpdj48ZGl2PjxzdHJvbmc+U09NRVRJTUVTIFlPVSBORUVEIFRP
IENPTlZFUlQgTU9SRSBPRiBUSEUgVFJBRkZJQyBZT1UgQUxSRUFEWSBIQVZFLjwvc3Ryb25nPjwvZGl2PjxkaXY+WW91J3JlIGdldHRpbmcgdmlzaXRvcnMu
PGJyPjxicj48L2Rpdj48ZGl2PllvdSdyZSBnZW5lcmF0aW5nIGludGVyZXN0Ljxicj48YnI+PC9kaXY+PGRpdj5NYXliZSB5b3UncmUgZXZlbiBnZXR0aW5n
IGxlYWRzLjxicj48YnI+PC9kaXY+PGRpdj5CdXQgaWYgdGhvc2UgdmlzaXRvcnMgYXJlbid0IHRha2luZyB0aGUgbmV4dCBzdGVwLCB5b3UncmUgbGVhdmlu
ZyByZXZlbnVlIG9uIHRoZSB0YWJsZS48YnI+PGJyPjwvZGl2PjxkaXY+VGhhdCdzIHdoZXJlIHRoZSA8c3Ryb25nPldvbGYgRm9yZ2UgQ29udmVyc2lvbiBP
cHRpbWl6YXRpb24gU3lzdGVtPC9zdHJvbmc+IGNvbWVzIGluLjxicj48YnI+PC9kaXY+PGRpdj5XZSdsbCBpZGVudGlmeSBhbmQgb3B0aW1pemUgdGhlIGNy
aXRpY2FsIHBvaW50cyBiZXR3ZWVuIDxzdHJvbmc+dmlzaXRvciDihpIgbGVhZCDihpIgYXBwb2ludG1lbnQg4oaSIGN1c3RvbWVyLjxicj48L3N0cm9uZz48
YnI+PC9kaXY+PGRpdj7wn46vIFdFJ0xMIE9QVElNSVpFOjwvZGl2PjxkaXY+4pyTIDxzdHJvbmc+Q1RBIE9wdGltaXphdGlvbjwvc3Ryb25nPiDigJQgTWFr
ZSB0aGUgbmV4dCBzdGVwIGNsZWFyPGJyPuKckyA8c3Ryb25nPk9mZmVyIE9wdGltaXphdGlvbjwvc3Ryb25nPiDigJQgU3RyZW5ndGhlbiB5b3VyIG9mZmVy
IGFuZCBwb3NpdGlvbmluZzxicj7inJMgPHN0cm9uZz5MYW5kaW5nIFBhZ2UgT3B0aW1pemF0aW9uPC9zdHJvbmc+IOKAlCBJbXByb3ZlIHRoZSBwYXRoIHRv
IGNvbnZlcnNpb248YnI+4pyTIDxzdHJvbmc+Rm9ybSBPcHRpbWl6YXRpb248L3N0cm9uZz4g4oCUIFJlZHVjZSBmcmljdGlvbiB3aGVuIHByb3NwZWN0cyBy
ZWFjaCBvdXQ8YnI+4pyTIDxzdHJvbmc+VHJ1c3QgU2lnbmFsczwvc3Ryb25nPiDigJQgQnVpbGQgY29uZmlkZW5jZSBiZWZvcmUgdGhlIGN1c3RvbWVyIGNv
bW1pdHM8YnI+4pyTIDxzdHJvbmc+U2FsZXMgTWVzc2FnaW5nPC9zdHJvbmc+IOKAlCBNYWtlIHlvdXIgbWVzc2FnZSBzcGVhayB0byB3aGF0IGN1c3RvbWVy
cyBhY3R1YWxseSB3YW50PGJyPuKckyA8c3Ryb25nPkJvb2tpbmcgRmxvdzwvc3Ryb25nPiDigJQgTWFrZSBzY2hlZHVsaW5nIGVhc2llciBhbmQgbW9yZSBl
ZmZpY2llbnQ8YnI+4pyTIDxzdHJvbmc+Rm9sbG93LVVwIEltcHJvdmVtZW50czwvc3Ryb25nPiDigJQgUmVkdWNlIG1pc3NlZCBvcHBvcnR1bml0aWVzIGFm
dGVyIHRoZSBpbml0aWFsIGlucXVpcnk8YnI+4pyTIDxzdHJvbmc+Q29udmVyc2lvbiBUcmFja2luZzwvc3Ryb25nPiDigJQgVW5kZXJzdGFuZCB3aGF0J3Mg
YWN0dWFsbHkgcHJvZHVjaW5nIHJlc3VsdHM8YnI+4pyTIDxzdHJvbmc+Q1JPIFJvYWRtYXA8L3N0cm9uZz4g4oCUIEtub3cgd2hhdCB0byBvcHRpbWl6ZSBu
ZXh0PGJyPjxicj48L2Rpdj48ZGl2PjxzdHJvbmc+QmVmb3JlIHdlIHNwZW5kIG1vcmUgbW9uZXkgZ2V0dGluZyB5b3UgdHJhZmZpYywgbGV0J3MgbWFrZSBz
dXJlIHRoZSB0cmFmZmljIHlvdSBhbHJlYWR5IGhhdmUgY29udmVydHMuPGJyPjwvc3Ryb25nPjxicj48L2Rpdj48ZGl2PkJlY2F1c2UgbW9yZSB0cmFmZmlj
IGRvZXNuJ3QgYXV0b21hdGljYWxseSBtZWFuIG1vcmUgY3VzdG9tZXJzLjxicj48YnI+PC9kaXY+PGRpdj48c3Ryb25nPkJldHRlciBjb252ZXJzaW9uIGRv
ZXMuPC9zdHJvbmc+PC9kaXY+IgogICAgfSwKICAgIHsKICAgICAgInNvdXJjZV9zZXJ2aWNlX2lkIjogNTgxLAogICAgICAibmFtZSI6ICJDb21wZXRpdGl2
ZSBEb21pbmF0aW9uIEJsdWVwcmludCIsCiAgICAgICJkZXNjcmlwdGlvbiI6ICI8ZGl2PvCfmqggPHN0cm9uZz5ZT1VSIENPTVBFVElUT1JTIEFSRSBBTFJF
QURZIFNIT1dJTkcgWU9VIFdIQVQgV09SS1MuPGJyPjwvc3Ryb25nPjxicj48L2Rpdj48ZGl2PjxzdHJvbmc+VEhFIFFVRVNUSU9OIElTOiBBUkUgWU9VIFVT
SU5HIFRIQVQgSU5GT1JNQVRJT04/PC9zdHJvbmc+PC9kaXY+PGRpdj5Zb3VyIGNvbXBldGl0b3JzIGFyZSByYW5raW5nIGZvciBrZXl3b3JkcyB5b3UgYXJl
bid0Ljxicj48YnI+PC9kaXY+PGRpdj5UaGV5IG1heSBoYXZlIHNlcnZpY2UgcGFnZXMgeW91IGRvbid0Ljxicj48YnI+PC9kaXY+PGRpdj5UaGV5IG1heSBi
ZSBkb21pbmF0aW5nIGNpdGllcyB5b3UncmUgbm90IHZpc2libGUgaW4uPGJyPjxicj48L2Rpdj48ZGl2PlRoZXkgbWF5IGhhdmUgc3Ryb25nZXIgYXV0aG9y
aXR5LCBiZXR0ZXIgY29udGVudCwgb3IgYSBzdHJvbmdlciBHb29nbGUgTWFwcyBwcmVzZW5jZS48YnI+PGJyPjwvZGl2PjxkaXY+VGhlIFdvbGYgRm9yZ2Ug
PHN0cm9uZz5Db21wZXRpdGl2ZSBEb21pbmF0aW9uIEJsdWVwcmludDwvc3Ryb25nPiB0YWtlcyB0aG9zZSBjb21wZXRpdGl2ZSBnYXBzIGFuZCB0dXJucyB0
aGVtIGludG8gYW4gPHN0cm9uZz5hY3Rpb25hYmxlIDkwLWRheSBncm93dGggc3RyYXRlZ3kuPGJyPjwvc3Ryb25nPjxicj48L2Rpdj48ZGl2PvCflKUgV0Un
TEwgQlVJTEQ6PC9kaXY+PGRpdj7inJMgPHN0cm9uZz5Db21wZXRpdG9yIEtleXdvcmQgR2FwIEltcGxlbWVudGF0aW9uPC9zdHJvbmc+IOKAlCBJZGVudGlm
eSBhbmQgdGFyZ2V0IHZhbHVhYmxlIGtleXdvcmRzIHlvdXIgY29tcGV0aXRvcnMgYXJlIHdpbm5pbmc8YnI+PGJyPjwvZGl2PjxkaXY+4pyTIDxzdHJvbmc+
Q29udGVudCBHYXAgU3RyYXRlZ3k8L3N0cm9uZz4g4oCUIEZpbmQgdGhlIHRvcGljcyBhbmQgY29udGVudCBvcHBvcnR1bml0aWVzIHlvdSdyZSBtaXNzaW5n
PGJyPjxicj48L2Rpdj48ZGl2PuKckyA8c3Ryb25nPlNlcnZpY2UtUGFnZSBTdHJhdGVneTwvc3Ryb25nPiDigJQgSWRlbnRpZnkgdGhlIHBhZ2VzIG5lZWRl
ZCB0byBjb21wZXRlIGZvciBoaWdoLWludGVudCBzZWFyY2hlczxicj48YnI+PC9kaXY+PGRpdj7inJMgPHN0cm9uZz5Mb2NhbC1QYWdlIFN0cmF0ZWd5PC9z
dHJvbmc+IOKAlCBVbmNvdmVyIGNpdHksIG5laWdoYm9yaG9vZCBhbmQgc2VydmljZS1hcmVhIG9wcG9ydHVuaXRpZXM8YnI+PGJyPjwvZGl2PjxkaXY+4pyT
IDxzdHJvbmc+SW50ZXJuYWwgTGlua2luZyBTdHJhdGVneTwvc3Ryb25nPiDigJQgQnVpbGQgc3Ryb25nZXIgY29ubmVjdGlvbnMgYmV0d2VlbiB5b3VyIG1v
c3QgaW1wb3J0YW50IHBhZ2VzPGJyPjxicj48L2Rpdj48ZGl2PuKckyA8c3Ryb25nPkF1dGhvcml0eSBTdHJhdGVneTwvc3Ryb25nPiDigJQgSWRlbnRpZnkg
b3Bwb3J0dW5pdGllcyB0byBzdHJlbmd0aGVuIHlvdXIgd2Vic2l0ZSdzIGF1dGhvcml0eSBhbmQgY29tcGV0aXRpdmVuZXNzPGJyPjxicj48L2Rpdj48ZGl2
PuKckyA8c3Ryb25nPkdvb2dsZSBNYXBzIE9wcG9ydHVuaXR5IFN0cmF0ZWd5PC9zdHJvbmc+IOKAlCBJZGVudGlmeSBsb2NhbCB2aXNpYmlsaXR5IGdhcHMg
eW91ciBjb21wZXRpdG9ycyBhcmUgZXhwbG9pdGluZzxicj48YnI+PC9kaXY+PGRpdj7inJMgPHN0cm9uZz45MC1EYXkgRXhlY3V0aW9uIFJvYWRtYXA8L3N0
cm9uZz4g4oCUIEtub3cgZXhhY3RseSB3aGF0IHNob3VsZCBiZSBwcmlvcml0aXplZCBhbmQgZXhlY3V0ZWQgZmlyc3Q8YnI+PGJyPjwvZGl2PjxkaXY+PGJy
PjwvZGl2PiIKICAgIH0KICBdCn0K
$seo_sprints_capture$,
      'base64'
    ),
    'UTF8'
  )::jsonb;
  captured_source_ids bigint[];
begin
  select array_agg(
    (source.service_data ->> 'source_service_id')::bigint
    order by source.display_order
  )
  into captured_source_ids
  from jsonb_array_elements(capture -> 'services')
    with ordinality as source(service_data, display_order);

  if (capture #>> '{folder,source_folder_id}')::bigint <> 54
    or capture #>> '{folder,name}' <> 'SEO Sprints'
    or (capture #>> '{folder,service_count}')::integer <> 10
    or jsonb_array_length(capture -> 'services') <> 10
    or captured_source_ids is distinct from array[
      571, 572, 573, 574, 575, 576, 577, 579, 580, 581
    ]::bigint[]
    or exists (
      select 1
      from jsonb_array_elements(capture -> 'services') as source(service_data)
      where nullif(source.service_data ->> 'description', '') is null
    )
  then
    raise exception 'invalid authoritative SEO Sprint description capture'
      using errcode = '22023';
  end if;

  insert into public.service_folders (
    id, name, description, image_url, parent_id, sort_order, archived_at
  ) values (
    folder_id, 'SEO Sprints', null, null, null, 0, null
  )
  on conflict (id) do update set
    name = excluded.name,
    description = excluded.description,
    image_url = excluded.image_url,
    parent_id = excluded.parent_id,
    sort_order = excluded.sort_order,
    archived_at = excluded.archived_at;

  with service_config (
    service_id,
    source_service_id,
    price,
    display_order
  ) as (
    values
      ('5e000000-0000-4000-8000-000000000101'::uuid, 571::bigint, 97::numeric, 1),
      ('5e000000-0000-4000-8000-000000000102'::uuid, 572::bigint, 97::numeric, 2),
      ('5e000000-0000-4000-8000-000000000103'::uuid, 573::bigint, 97::numeric, 3),
      ('5e000000-0000-4000-8000-000000000104'::uuid, 574::bigint, 97::numeric, 4),
      ('5e000000-0000-4000-8000-000000000105'::uuid, 575::bigint, 97::numeric, 5),
      ('5e000000-0000-4000-8000-000000000106'::uuid, 576::bigint, 97::numeric, 6),
      ('5e000000-0000-4000-8000-000000000107'::uuid, 577::bigint, 97::numeric, 7),
      ('5e000000-0000-4000-8000-000000000108'::uuid, 579::bigint, 2500::numeric, 8),
      ('5e000000-0000-4000-8000-000000000109'::uuid, 580::bigint, 997::numeric, 9),
      ('5e000000-0000-4000-8000-000000000110'::uuid, 581::bigint, 497::numeric, 10)
  )
  insert into public.services (
    id,
    name,
    folder_id,
    description,
    price,
    currency,
    image_url,
    is_active,
    is_public,
    recurring,
    recurring_price,
    recurring_interval_length,
    recurring_interval_unit,
    recurring_action,
    group_quantities,
    assigned_to_profile_id,
    deadline_amount,
    deadline_unit,
    require_client_profile,
    sort_order,
    archived_at
  )
  select
    config.service_id,
    source.service_data ->> 'name',
    folder_id,
    source.service_data ->> 'description',
    config.price,
    'USD',
    null,
    true,
    true,
    false,
    null,
    null,
    null,
    null,
    false,
    null,
    null,
    null,
    false,
    config.display_order,
    null
  from service_config as config
  join jsonb_array_elements(capture -> 'services') as source(service_data)
    on (source.service_data ->> 'source_service_id')::bigint =
       config.source_service_id
  on conflict (id) do update set
    name = excluded.name,
    folder_id = excluded.folder_id,
    description = excluded.description,
    price = excluded.price,
    currency = excluded.currency,
    image_url = excluded.image_url,
    is_active = excluded.is_active,
    is_public = excluded.is_public,
    recurring = excluded.recurring,
    recurring_price = excluded.recurring_price,
    recurring_interval_length = excluded.recurring_interval_length,
    recurring_interval_unit = excluded.recurring_interval_unit,
    recurring_action = excluded.recurring_action,
    group_quantities = excluded.group_quantities,
    assigned_to_profile_id = excluded.assigned_to_profile_id,
    deadline_amount = excluded.deadline_amount,
    deadline_unit = excluded.deadline_unit,
    require_client_profile = excluded.require_client_profile,
    sort_order = excluded.sort_order,
    archived_at = excluded.archived_at;

  with service_identity (service_id, source_service_id) as (
    values
      ('5e000000-0000-4000-8000-000000000101'::uuid, 571::bigint),
      ('5e000000-0000-4000-8000-000000000102'::uuid, 572::bigint),
      ('5e000000-0000-4000-8000-000000000103'::uuid, 573::bigint),
      ('5e000000-0000-4000-8000-000000000104'::uuid, 574::bigint),
      ('5e000000-0000-4000-8000-000000000105'::uuid, 575::bigint),
      ('5e000000-0000-4000-8000-000000000106'::uuid, 576::bigint),
      ('5e000000-0000-4000-8000-000000000107'::uuid, 577::bigint),
      ('5e000000-0000-4000-8000-000000000108'::uuid, 579::bigint),
      ('5e000000-0000-4000-8000-000000000109'::uuid, 580::bigint),
      ('5e000000-0000-4000-8000-000000000110'::uuid, 581::bigint)
  )
  insert into private.wayfront_service_catalog_sources (
    service_id,
    source_service_id,
    source_folder_id,
    display_order,
    source_url,
    source_data
  )
  select
    mapping.service_id,
    mapping.source_service_id,
    54,
    source.display_order::integer,
    format(
      'https://services.rankfortress.com/services/%s',
      mapping.source_service_id
    ),
    source.service_data
  from service_identity as mapping
  join jsonb_array_elements(capture -> 'services')
    with ordinality as source(service_data, display_order)
    on (source.service_data ->> 'source_service_id')::bigint =
       mapping.source_service_id
  on conflict (service_id) do update set
    source_service_id = excluded.source_service_id,
    source_folder_id = excluded.source_folder_id,
    display_order = excluded.display_order,
    source_url = excluded.source_url,
    source_data = excluded.source_data;
end;
$function$;

revoke all on function private.seed_seo_sprints_catalog()
from public, anon, authenticated, service_role;

-- Exercise the same complete deterministic boundary used by local resets and
-- repeated seed runs. The seven fully captured folders remain unchanged.
select private.seed_wolf_forge_services_catalog();
