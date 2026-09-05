#import "base.typ": kompass-document
#let p = json("/data.json")
#show: kompass-document.with(p, letterhead: p.data.letterhead)

= #p.data.title

#for para in p.data.body.split("\n\n") {
  par(para)
}
