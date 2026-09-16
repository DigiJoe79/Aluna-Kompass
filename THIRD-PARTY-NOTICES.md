# Hinweise zu Software Dritter

Aluna Kompass steht unter Apache-2.0 (siehe `LICENSE` und `NOTICE`). Das
ausgelieferte Container-Image enthält darüber hinaus Software Dritter unter
eigenen Bedingungen. Diese Datei führt sie auf.

**Diese Datei wird erzeugt, nicht gepflegt.** Quelle ist das gebaute Image:

```
scripts/third-party-notices.sh [image]
```

Stand: Debian 12.15, 167 Systempakete, 398 npm-Pakete.

Die Aufstellung gilt für jede Bauarchitektur: Pakete, die je Plattform unter
eigenem Namen liegen, stehen zusammengefasst als `…-<plattform>`, und die
Rebuild-Suffixe von Debian (`+b1`) sind abgeschnitten. Beides ändert die
Lizenz nicht — nur die Datei, die sie nennt.

## 1. Quellcode

Ein Teil der enthaltenen Software steht unter GPL oder LGPL. Deren Quellcode
ist auf zwei Wegen zu haben:

**Systempakete (Debian).** Alle Debian-Pakete sind unverändert übernommen. Der
zugehörige Quellcode liegt dauerhaft unter <https://snapshot.debian.org/> — das
Archiv hält jede Paketfassung mit ihrer Versionsnummer vor, anders als die
rollende Distribution. Die Versionen stehen in Abschnitt 2.

**libvips und Abhängigkeiten.** Quellen und Bauanleitung:
<https://github.com/lovell/sharp-libvips>. Die Bibliothek ist als eigene
Datei eingebunden und wird dynamisch geladen (`libvips-cpp.so`); sie lässt
sich gegen eine selbst übersetzte Fassung austauschen.

**Schriftliches Angebot.** Unabhängig davon: Wer eine Kopie des Quellcodes der
hier aufgeführten GPL- und LGPL-Bestandteile wünscht, erhält sie auf Anfrage,
für **drei Jahre** ab Auslieferung der jeweiligen Fassung, zu den Selbstkosten
des Datenträgers. Den Weg dorthin nennt das README des Projekts im Abschnitt
„Fragen, Fehler und Sicherheit"; eine solche Anfrage ist nicht vertraulich und
gehört in ein gewöhnliches Issue.

## 2. Systempakete (Debian 12.15)

167 Pakete, davon 117 mit einer GPL-Lizenzangabe. Quellcode über
<https://snapshot.debian.org/> unter der jeweils genannten Version.

Wo statt einer Lizenz „siehe …/copyright" steht, trägt das Paket seine Angabe
weder im maschinenlesbaren Format noch als Verweis auf
`/usr/share/common-licenses`. Das betrifft ausschließlich X11- und
Schriftbibliotheken unter MIT-/X11-artigen Bedingungen; die Datei liegt im
Image unter dem genannten Pfad.

| Paket | Version | Lizenzangaben laut `copyright` |
|---|---|---|
| `adduser` | `3.134` | GPL-2+ |
| `apt` | `2.6.1` | BSD-3-clause,Expat,GPL-2,GPL-2+ |
| `base-files` | `12.4+deb12u15` | GPL |
| `base-passwd` | `3.6.1` | GPL-2,public-domain |
| `bash` | `5.2.15-2` | BSD-4-clause-UC,BSD-4-clause-UC and MIT-like,GFDL-NIV-1.3,GPL-2+,GPL-3+,GPL-3+ with Bison exception,Latex2e,MIT-like,permissive |
| `bsdutils` | `1:2.38.1-5+deb12u3` | BSD-3-clause,BSD-4-clause,BSLA,GPL-2,GPL-2+,GPL-3+,LGPL,LGPL-2+,LGPL-2.1+,LGPL-3+,MIT,public-domain |
| `ca-certificates` | `20250419~deb12u1` | GPL-2+,MPL-2.0 |
| `coreutils` | `9.1-1` | BSD-4-clause-UC,FSFULLR,GFDL-NIV-1.3,GPL-3+,GPL-3+ and BSD-4-clause-UC,GPL-3+ and ISC,ISC |
| `dash` | `0.5.12-2` | BSD-3-Clause,BSD-3-clause,GPL-2+,public-domain |
| `debconf` | `1.5.82` | BSD-2-clause |
| `debian-archive-keyring` | `2023.3+deb12u2` | GPL |
| `debianutils` | `5.7-0.5~deb12u1` | GPL-2+,SMAIL-GPL,public-domain |
| `diffutils` | `1:3.8-4` | FSFAP,FSFULLR,GFDL-NIV-1.3,GPL-2+,GPL-3+,GPL-3+ and FSFULLR,GPL-3+ with autoconf exception,GPL-3+ with texinfo exception,LGPL-2.0+,LGPL-2.1+,LGPL-3.0+,LGPL-3.0+ or GPL-2+,X11,public-domain |
| `dpkg` | `1.21.23` | BSD-2-clause,GPL-2,GPL-2+,public-domain-s-s-d |
| `e2fsprogs` | `1.47.0-2` | Apache-2,BSD-3-Clause,GPL or MIT-US-export,GPL-2,GPL-2+ with Texinfo exception,ISC,Kazlib,LGPL-2,Latex2e |
| `findutils` | `4.9.0-4` | BSD-3-clause,BSD-3-clause and/or GPL-3+,FSFAP,FSFULLR,GFDL-NIV-1.3+,GPL with automake exception,GPL-2+,GPL-2+ with Autoconf-data exception,GPL-3+,GPL-3+ with Autoconf-data exception,GPL-3+ with Bison-2.2 exception,ISC,ISC and/or LGPL-2.1+,LGPL-2+,LGPL-2.1+,LGPL-3,LGPL-3+,X11,public-domain |
| `fontconfig` | `2.14.1-4` | siehe /usr/share/doc/fontconfig/copyright |
| `fontconfig-config` | `2.14.1-4` | siehe /usr/share/doc/fontconfig-config/copyright |
| `fonts-dejavu-core` | `2.37-6` | GPL-2+,bitstream-vera |
| `gcc-12-base` | `12.2.0-14+deb12u1` | Artistic,GFDL-1.2,GPL,GPL-2,GPL-3,GPL.,LGPL. |
| `gpgv` | `2.2.40-1.1+deb12u2` | BSD-3-clause,CC0-1.0,Expat,GPL-3+,GPL-3+ or BSD-3-clause,LGPL-2.1+,LGPL-3+,RFC-Reference,TinySCHEME,permissive |
| `grep` | `3.8-5` | GPL-3+ |
| `gzip` | `1.12-1` | FSF-manpages,GFDL-1.3+-no-invariant,GPL-3+ |
| `hostname` | `3.23+nmu1` | GPL-2 |
| `init-system-helpers` | `1.65.2+deb12u1` | BSD-3-clause,GPL-2+ |
| `libacl1` | `2.3.1-3` | GPL-2+,LGPL-2+ |
| `libapt-pkg6.0` | `2.6.1` | BSD-3-clause,Expat,GPL-2,GPL-2+ |
| `libarchive13` | `3.6.2-1+deb12u5` | Apache-2.0,Apache-2.0 or CC0-1.0 or OpenSSL+SSLeay,BSD-1-clause-UCB,BSD-124-clause-UCB,BSD-2-clause,BSD-2-clause and BSD-1-clause-UCB,BSD-2-clause and BSD-124-clause-UCB,BSD-2-clause and BSD-3-clause-UCB,BSD-2-clause and Expat,BSD-3-clause-UCB,BSD-4-clause-UCB,CC0-1.0,Expat,OpenSSL+SSLeay,PD |
| `libatomic1` | `12.2.0-14+deb12u1` | Artistic,GFDL-1.2,GPL,GPL-2,GPL-3,GPL.,LGPL. |
| `libattr1` | `1:2.5.1-4` | GPL-2+,LGPL-2+ |
| `libaudit-common` | `1:3.0.9-1` | GPL-2,LGPL-2.1 |
| `libaudit1` | `1:3.0.9-1` | GPL-2,LGPL-2.1 |
| `libblkid1` | `2.38.1-5+deb12u3` | BSD-3-clause,BSD-4-clause,BSLA,GPL-2,GPL-2+,GPL-3+,LGPL,LGPL-2+,LGPL-2.1+,LGPL-3+,MIT,public-domain |
| `libbrotli1` | `1.0.9-2` | MIT |
| `libbsd0` | `0.11.7-2` | BSD-2-clause,BSD-2-clause-NetBSD,BSD-2-clause-author,BSD-2-clause-verbatim,BSD-3-clause,BSD-3-clause-John-Birrell,BSD-3-clause-Regents,BSD-3-clause-Regents and BSD-2-clause-NetBSD,BSD-3-clause-author,BSD-4-clause-Niels-Provos,Beerware,Expat,ISC,ISC-Original,libutil-David-Nugent,public-domain |
| `libbz2-1.0` | `1.0.8-5` | BSD-variant,GPL-2 |
| `libc-bin` | `2.36-9+deb12u14` | GPL-2,LGPL-2.1 |
| `libc6` | `2.36-9+deb12u14` | GPL-2,LGPL-2.1 |
| `libcairo2` | `1.16.0-7` | LGPL-2.1 |
| `libcap-ng0` | `0.8.3-1` | GPL-2+,GPL-3,LGPL-2.1+ |
| `libcap2` | `1:2.66-4+deb12u3` | BSD-3-clause,BSD-3-clause or GPL-2,BSD-3-clause or GPL-2+,GPL-2,GPL-2+ |
| `libcbor0.8` | `0.8.0-2` | Expat |
| `libcom-err2` | `1.47.0-2` | Apache-2,BSD-3-Clause,GPL or MIT-US-export,GPL-2,GPL-2+ with Texinfo exception,ISC,Kazlib,LGPL-2,Latex2e |
| `libcrypt1` | `1:4.4.33-2` | siehe /usr/share/doc/libcrypt1/copyright |
| `libcurl4` | `7.88.1-10+deb12u15` | BSD-3-Clause,BSD-3-clause,BSD-4-Clause-UC,FSFULLR,GPL-2+ with Autoconf-data exception,GPL-2+ with Libtool exception,GPL-3+ with Autoconf-data exception,ISC,OLDAP-2.8,X11,curl |
| `libdatrie1` | `0.2.13-2` | GPL-2+,LGPL-2.1+ |
| `libdb5.3` | `5.3.28+dfsg2-1` | Artistic or BSD-3-clause,BSD-3-clause,BSD-3-clause-fjord,GPL,GPL or Artistic,GPL-3,MIT-old,Ms-PL,Sleepycat,Sleepycat and BSD-3-clause,TCL-like,X11,zlib |
| `libdebconfclient0` | `0.270` | BSD-2-Clause,BSD-2-clause,GPL-2+ |
| `libdeflate0` | `1.14-1` | Expat |
| `libedit2` | `3.1-20221030-2` | BSD-3-clause |
| `libexpat1` | `2.5.0-1+deb12u3` | MIT |
| `libext2fs2` | `1.47.0-2` | Apache-2,BSD-3-Clause,GPL or MIT-US-export,GPL-2,GPL-2+ with Texinfo exception,ISC,Kazlib,LGPL-2,Latex2e |
| `libffi8` | `3.4.4-1` | Expat,GPL,GPL-2+,GPL-3+,MPL-1.1 or GPL-2+ or LGPL-2.1+,X11,public-domain |
| `libfido2-1` | `1.12.0-2` | BSD-2-clause,ISC,ISC and BSD-2-clause,public-domain |
| `libfontconfig1` | `2.14.1-4` | siehe /usr/share/doc/libfontconfig1/copyright |
| `libfreetype6` | `2.12.1+dfsg-5+deb12u4` | BSD-3-Clause,BSL-1.0,FSFAP,FTL,FTL and MIT,GPL-2+,GPL-3+,MIT,OpenGroup-BSD-like,Public-Domain,Zlib |
| `libfribidi0` | `1.0.8-2.1` | LGPL-2.1+ |
| `libgcc-s1` | `12.2.0-14+deb12u1` | Artistic,GFDL-1.2,GPL,GPL-2,GPL-3,GPL.,LGPL. |
| `libgcrypt20` | `1.10.1-3+deb12u1` | License: |
| `libgif7` | `5.2.1-2.5+deb12u1` | ISC,MIT |
| `libglib2.0-0` | `2.74.6-2+deb12u9` | AFL-2.0,AFL-2.0 or LGPL-2.1+,Apache-2.0 with LLVM exception,BSD-3-clause-pcre,CC-BY-SA-3.0,CC0-1.0,Expat,FSFULLR,GPL-2+,GPL-2+ with Autoconf exception,Iconv-PD,Janik-permissive,Kuchling-PD,LGPL-2+,LGPL-2+ and LGPL-2.1+ and FSFULLR and CC0-1.0 and Janik-permissive and Iconv-PD and Mingw-PD and Old-GLib-Tests-permissive,LGPL-2.1+,LGPL-2.1+ and BSD-3-clause-pcre,LGPL-2.1+ and Expat,LGPL-2.1+ and Kuchling-PD and Plumb-PD,LGPL-3+,Mingw-PD,Old-GLib-Tests-permissive,Plumb-PD,Unicode-DFS-2016,bzip2-1.0.6 |
| `libgmp10` | `2:6.2.1+dfsg1-1.1` | GPL-2+,GPL-2+ or LGPL-3+,GPL-3+,GPL-3+ with Bison exception,LGPL-3+ |
| `libgnutls30` | `3.7.9-2+deb12u7` | Apache-2.0,BSD-3-Clause,CC0 license,Expat,GPLv3+,LGPLv2.1+,LGPLv3+_or_GPLv2+,License:,The main library is licensed under GNU Lesser |
| `libgomp1` | `12.2.0-14+deb12u1` | Artistic,GFDL-1.2,GPL,GPL-2,GPL-3,GPL.,LGPL. |
| `libgpg-error0` | `1.46-1` | BSD-3-clause,GPL-3+,LGPL-2.1+,LGPL-2.1+ or BSD-3-clause,g10-permissive |
| `libgraphite2-3` | `1.3.14-1+deb12u1` | Artistic,Artistic or GPL-1+,GPL-1+,GPL-2+,LGPL-2.1+,LGPL-2.1+ or GPL-2+ or MPL-1.1,LGPL-2.1+ or MPL-1.1 or GPL-2+,MPL-1.1,custom-sil-open-font-license,public-domain |
| `libgssapi-krb5-2` | `1.20.1-2+deb12u5` | GPL-2 |
| `libharfbuzz0b` | `6.0.0+dfsg-3` | Apache-2.0,CC0-1.0,Expat,FSFAP,FSFUL,FSFULLR,GPL-2+ with AutoConf exception,GPL-2+ with Font exception,GPL-2+ with LibTool exception,GPL-3+,GPL-3+ with AutoConf exception,ISC,LGPL-2.1+,MIT,Monotype,OFL-1.1,UFL-1.0,Unicode |
| `libhogweed6` | `3.8.1-2` | Expat,GAP,GPL-2,GPL-2+,GPL-3+,GPL-3+ with Autoconf exception,LGPL-2+,LGPL-3+,LGPL-3+ or GPL-2+,public-domain |
| `libicu72` | `72.1-3+deb12u1` | GPL-3,MIT |
| `libidn2-0` | `2.3.3-1` | GPL-2+,GPL-3+,LGPL-3+,LGPL-3+ or GPL-2+,Unicode |
| `libjbig0` | `2.1-6.1` | GPL-2+ |
| `libjpeg62-turbo` | `1:2.1.5-2` | BSD-3-clause,BSD-BY-LC-NE,Expat,License:zlib,NTP,Zlib |
| `libk5crypto3` | `1.20.1-2+deb12u5` | GPL-2 |
| `libkeyutils1` | `1.6.3-2` | GPL-2+,LGPL-2+ |
| `libkrb5-3` | `1.20.1-2+deb12u5` | GPL-2 |
| `libkrb5support0` | `1.20.1-2+deb12u5` | GPL-2 |
| `liblcms2-2` | `2.14-2+deb12u1` | GPL-2+,GPL-3,IJG,MIT |
| `libldap-2.5-0` | `2.5.13+dfsg-5` | BSD-3-clause,BSD-3-clause-California,BSD-3-clause-variant,BSD-4-clause-California,Beerware,Expat,Expat-ISC,Expat-UNM,F5,FSF-unlimited,FSF-unlimited and GPL-2+ with Autoconf exception,FSF-unlimited and GPL-2+ with Libtool exception,FSF-unlimited and OpenLDAP-2.8,GPL-2+,GPL-2+ with Autoconf exception,GPL-2+ with Libtool exception,GPL-2+ with Libtool exception and GPL-3+ with Libtool exception and GPL-3+,GPL-3+,GPL-3+ with Autoconf exception,GPL-3+ with Libtool exception,JCG,MIT-XC,NeoSoft-permissive,OpenLDAP-2.8,OpenLDAP-2.8 and BSD-3-clause,OpenLDAP-2.8 and BSD-3-clause-variant,OpenLDAP-2.8 and BSD-4-clause-California,OpenLDAP-2.8 and Beerware,OpenLDAP-2.8 and Expat,OpenLDAP-2.8 and Expat-ISC,OpenLDAP-2.8 and Expat-UNM,OpenLDAP-2.8 and FSF-unlimited and GPL-2+ with Libtool exception,OpenLDAP-2.8 and JCG and UMich,OpenLDAP-2.8 and UMich,OpenLDAP-2.8 and UMich and F5,UMich,public-domain |
| `liblept5` | `1.82.0-3` | License: |
| `liblerc4` | `4.0.0+ds-2` | Apache-2.0 |
| `liblz4-1` | `1.9.4-1` | BSD-2-clause,GPL-2+,GPL-2+ or BSD-2-clause |
| `liblzma5` | `5.4.1-1+deb12u1` | Autoconf,GPL-2,GPL-2+,LGPL-2.1+,License:,PD,PD-debian,config-h,noderivs,none,permissive-fsf,permissive-nowarranty,probably-PD |
| `libmd0` | `1.0.4-2` | BSD-2-clause,BSD-2-clause-NetBSD,BSD-3-clause,BSD-3-clause-Aaron-D-Gifford,Beerware,ISC,public-domain-md4,public-domain-md5,public-domain-sha1 |
| `libmount1` | `2.38.1-5+deb12u3` | BSD-3-clause,BSD-4-clause,BSLA,GPL-2,GPL-2+,GPL-3+,LGPL,LGPL-2+,LGPL-2.1+,LGPL-3+,MIT,public-domain |
| `libnettle8` | `3.8.1-2` | Expat,GAP,GPL-2,GPL-2+,GPL-3+,GPL-3+ with Autoconf exception,LGPL-2+,LGPL-3+,LGPL-3+ or GPL-2+,public-domain |
| `libnghttp2-14` | `1.52.0-1+deb12u3` | BSD-2-clause,Expat,GPL-3+ with autoconf exception,MIT,all-permissive |
| `libnspr4` | `2:4.35-1` | MPL-2.0 |
| `libnss3` | `2:3.87.1-1+deb12u4` | BSD-3,MPL-2.0,Zlib,public-domain |
| `libopenjp2-7` | `2.5.0-2+deb12u3` | BSD-2,BSD-3,LIBPNG,LIBTIFF,LIBTIFF-GLARSON,LIBTIFF-PIXAR,MIT,ZLIB,public-domain |
| `libp11-kit0` | `0.24.1-2` | Apache-2.0,BSD-3-Clause,ISC,ISC+IBM,LGPL-2.1+,permissive-like-automake-output,same-as-rest-of-p11kit |
| `libpam-modules` | `1.5.2-6+deb12u2` | BSD-3-clause or GPL,BSD-tcp_wrappers,Beerware,GPL-2,GPL-2+,GPL-3,GPL-3+ with Bison exception,LGPL-2+,public-domain |
| `libpam-modules-bin` | `1.5.2-6+deb12u2` | BSD-3-clause or GPL,BSD-tcp_wrappers,Beerware,GPL-2,GPL-2+,GPL-3,GPL-3+ with Bison exception,LGPL-2+,public-domain |
| `libpam-runtime` | `1.5.2-6+deb12u2` | BSD-3-clause or GPL,BSD-tcp_wrappers,Beerware,GPL-2,GPL-2+,GPL-3,GPL-3+ with Bison exception,LGPL-2+,public-domain |
| `libpam0g` | `1.5.2-6+deb12u2` | BSD-3-clause or GPL,BSD-tcp_wrappers,Beerware,GPL-2,GPL-2+,GPL-3,GPL-3+ with Bison exception,LGPL-2+,public-domain |
| `libpango-1.0-0` | `1.50.12+ds-1` |   Unicode,Apache-2,Apache-2 and Bitstream-Vera and OFL-1.1,Bitstream-Vera,CC0-1.0,Chromium-BSD-style,Example,GPL-2+,ICU,LGPL-2+,LGPL-2+ and ICU,LGPL-2+ and LGPL-2.1+,LGPL-2+ and TCL,LGPL-2.1+,OFL-1.1,TCL,Unicode |
| `libpangocairo-1.0-0` | `1.50.12+ds-1` |   Unicode,Apache-2,Apache-2 and Bitstream-Vera and OFL-1.1,Bitstream-Vera,CC0-1.0,Chromium-BSD-style,Example,GPL-2+,ICU,LGPL-2+,LGPL-2+ and ICU,LGPL-2+ and LGPL-2.1+,LGPL-2+ and TCL,LGPL-2.1+,OFL-1.1,TCL,Unicode |
| `libpangoft2-1.0-0` | `1.50.12+ds-1` |   Unicode,Apache-2,Apache-2 and Bitstream-Vera and OFL-1.1,Bitstream-Vera,CC0-1.0,Chromium-BSD-style,Example,GPL-2+,ICU,LGPL-2+,LGPL-2+ and ICU,LGPL-2+ and LGPL-2.1+,LGPL-2+ and TCL,LGPL-2.1+,OFL-1.1,TCL,Unicode |
| `libpcre2-8-0` | `10.42-1` | BSD-2-clause,BSD-3-clause,BSD-3-clause-Cambridge with BINARY LIBRARY-LIKE PACKAGES exception,X11,public-domain |
| `libpixman-1-0` | `0.42.2-1` | siehe /usr/share/doc/libpixman-1-0/copyright |
| `libpng16-16` | `1.6.39-2+deb12u5` | Apache-2.0,BSD-3-clause,BSD-like-with-advertising-clause,GPL-2+,GPL-2+ or BSD-like-with-advertising-clause,expat,libpng,libpng OR Apache-2.0 OR BSD-3-clause |
| `libpoppler126` | `22.12.0-2+deb12u3` | Apache-2.0,GPL-2,GPL-2 or GPL-3,GPL-3 |
| `libpopt0` | `1.19+dfsg-1` | GPL-2+,expat |
| `libpsl5` | `0.21.2-1` | Chromium,MIT,gnulib |
| `librtmp1` | `2.4+20151223.gitfa8646d.1-2` | GPL-2,LGPL-2.1 |
| `libsasl2-2` | `2.1.28+dfsg-10` | BSD-2-clause,BSD-2-clause and MIT-CMU,BSD-2.2-clause,BSD-3-clause,BSD-3-clause-JANET,BSD-3-clause-JANET and BSD-4-clause,BSD-3-clause-PADL,BSD-3-clause-PADL and MIT-OpenVision,BSD-4-clause,BSD-4-clause and BSD-4-clause-KTH,BSD-4-clause and IBM-as-is,BSD-4-clause and MIT-Export,BSD-4-clause-KTH,BSD-4-clause-UC,FSFULLR,FSFULLR and MIT-CMU,GPL-3,GPL-3+,IBM-as-is,MIT-CMU,MIT-Export,MIT-OpenVision,OpenLDAP,OpenSSL,OpenSSL and SSLeay,RSA-MD,SSLeay |
| `libsasl2-modules-db` | `2.1.28+dfsg-10` | BSD-2-clause,BSD-2-clause and MIT-CMU,BSD-2.2-clause,BSD-3-clause,BSD-3-clause-JANET,BSD-3-clause-JANET and BSD-4-clause,BSD-3-clause-PADL,BSD-3-clause-PADL and MIT-OpenVision,BSD-4-clause,BSD-4-clause and BSD-4-clause-KTH,BSD-4-clause and IBM-as-is,BSD-4-clause and MIT-Export,BSD-4-clause-KTH,BSD-4-clause-UC,FSFULLR,FSFULLR and MIT-CMU,GPL-3,GPL-3+,IBM-as-is,MIT-CMU,MIT-Export,MIT-OpenVision,OpenLDAP,OpenSSL,OpenSSL and SSLeay,RSA-MD,SSLeay |
| `libseccomp2` | `2.5.4-1+deb12u1` | LGPL-2.1 |
| `libselinux1` | `3.4-1` | GPL-2,LGPL-2.1 |
| `libsemanage-common` | `3.4-1` | GPL,LGPL |
| `libsemanage2` | `3.4-1` | GPL,LGPL |
| `libsepol2` | `3.4-2.1` | GPL-2,GPL-2+,LGPL-2.1+,Zlib |
| `libsmartcols1` | `2.38.1-5+deb12u3` | BSD-3-clause,BSD-4-clause,BSLA,GPL-2,GPL-2+,GPL-3+,LGPL,LGPL-2+,LGPL-2.1+,LGPL-3+,MIT,public-domain |
| `libsqlite3-0` | `3.40.1-2+deb12u2` | GPL-2+,public-domain |
| `libss2` | `1.47.0-2` | Apache-2,BSD-3-Clause,GPL or MIT-US-export,GPL-2,GPL-2+ with Texinfo exception,ISC,Kazlib,LGPL-2,Latex2e |
| `libssh2-1` | `1.10.0-3+deb12u1` | BSD3 |
| `libssl3` | `3.0.20-1~deb12u2` | Apache-2.0,Artistic,Artistic or GPL-1+,GPL-1+ |
| `libstdc++6` | `12.2.0-14+deb12u1` | Artistic,GFDL-1.2,GPL,GPL-2,GPL-3,GPL.,LGPL. |
| `libsystemd0` | `252.39-1~deb12u2` | CC0-1.0,Expat,GPL-2 with Linux-syscall-note exception,GPL-2+,LGPL-2.1+,public-domain |
| `libtasn1-6` | `4.19.0-2+deb12u1` | GFDL-1.3.,GPL-3.,LGPL,LGPL-2.1 |
| `libtesseract5` | `5.3.0-2` | Apache-2.0 |
| `libthai-data` | `0.1.29-1` | GPL-2+,LGPL-2.1+ |
| `libthai0` | `0.1.29-1` | GPL-2+,LGPL-2.1+ |
| `libtiff6` | `4.5.0-6+deb12u4` | Hylafax |
| `libtinfo6` | `6.4-4` | BSD-3-clause,MIT/X11,X11 |
| `libudev1` | `252.39-1~deb12u2` | CC0-1.0,Expat,GPL-2 with Linux-syscall-note exception,GPL-2+,LGPL-2.1+,public-domain |
| `libunistring2` | `1.0-2` | FreeSoftware,GFDL-1.2+,GPL-2+,GPL-2+ with distribution exception,GPL-3+,GPL-3+ or GFDL-1.2+,LGPL-3+,LGPL-3+ or GPL-2+,MIT |
| `libuuid1` | `2.38.1-5+deb12u3` | BSD-3-clause,BSD-4-clause,BSLA,GPL-2,GPL-2+,GPL-3+,LGPL,LGPL-2+,LGPL-2.1+,LGPL-3+,MIT,public-domain |
| `libwebp7` | `1.2.4-0.2+deb12u1` | License: |
| `libwebpmux3` | `1.2.4-0.2+deb12u1` | License: |
| `libx11-6` | `2:1.8.4-2+deb12u2` | siehe /usr/share/doc/libx11-6/copyright |
| `libx11-data` | `2:1.8.4-2+deb12u2` | siehe /usr/share/doc/libx11-data/copyright |
| `libxau6` | `1:1.0.9-1` | siehe /usr/share/doc/libxau6/copyright |
| `libxcb-render0` | `1.15-1` | siehe /usr/share/doc/libxcb-render0/copyright |
| `libxcb-shm0` | `1.15-1` | siehe /usr/share/doc/libxcb-shm0/copyright |
| `libxcb1` | `1.15-1` | siehe /usr/share/doc/libxcb1/copyright |
| `libxdmcp6` | `1:1.1.2-3` | siehe /usr/share/doc/libxdmcp6/copyright |
| `libxext6` | `2:1.3.4-1` | siehe /usr/share/doc/libxext6/copyright |
| `libxml2` | `2.9.14+dfsg-1.3~deb12u6` | ISC,MIT-1 |
| `libxrender1` | `1:0.9.10-1.1` | siehe /usr/share/doc/libxrender1/copyright |
| `libxxhash0` | `0.8.1-1` | BSD-2-clause,GPL-2 |
| `libzstd1` | `1.5.4+dfsg2-5` | BSD-3-clause,BSD-3-clause or GPL-2,Expat,GPL-2,zlib |
| `login` | `1:4.13+dfsg1-1+deb12u2` | BSD-3-clause,GPL-1,GPL-2+,public-domain |
| `logsave` | `1.47.0-2` | Apache-2,BSD-3-Clause,GPL or MIT-US-export,GPL-2,GPL-2+ with Texinfo exception,ISC,Kazlib,LGPL-2,Latex2e |
| `mawk` | `1.3.4.20200120-3.1` | CC-BY-3.0,GPL-2,X11 |
| `mount` | `2.38.1-5+deb12u3` | BSD-3-clause,BSD-4-clause,BSLA,GPL-2,GPL-2+,GPL-3+,LGPL,LGPL-2+,LGPL-2.1+,LGPL-3+,MIT,public-domain |
| `ncurses-base` | `6.4-4` | BSD-3-clause,MIT/X11,X11 |
| `ncurses-bin` | `6.4-4` | BSD-3-clause,MIT/X11,X11 |
| `openssh-client` | `1:9.2p1-2+deb12u10` | BSD-2-clause,BSD-3-clause,Expat-with-advertising-restriction,Mazieres-BSD-style,OpenSSH,Powell-BSD-style,public-domain |
| `openssl` | `3.0.20-1~deb12u2` | Apache-2.0,Artistic,Artistic or GPL-1+,GPL-1+ |
| `passwd` | `1:4.13+dfsg1-1+deb12u2` | BSD-3-clause,GPL-1,GPL-2+,public-domain |
| `perl-base` | `5.36.0-7+deb12u3` |  CC0-1.0,Artistic,Artistic or GPL-1+ or Artistic-dist,Artistic-2,Artistic-dist,BSD-3-clause,BSD-3-clause-GENERIC,BSD-3-clause-with-weird-numbering,BSD-4-clause-POWERDOG,BZIP,DONT-CHANGE-THE-GPL,Expat,Expat or GPL-1+ or Artistic,GPL-1+,GPL-1+ or Artistic,GPL-1+ or Artistic or Artistic-dist,GPL-1+ or Artistic, and BSD-3-clause-GENERIC,GPL-1+ or Artistic, and BSD-4-clause-POWERDOG,GPL-1+ or Artistic, and Expat,GPL-1+ or Artistic, and Unicode,GPL-2+,GPL-2+ or Artistic,GPL-3+-WITH-BISON-EXCEPTION,HSIEH-BSD,HSIEH-DERIVATIVE,LGPL-2.1,REGCOMP,REGCOMP, and GPL-1+ or Artistic,RRA-KEEP-THIS-NOTICE,SDBM-PUBLIC-DOMAIN,TEXT-TABS,Unicode,ZLIB |
| `poppler-utils` | `22.12.0-2+deb12u3` | Apache-2.0,GPL-2,GPL-2 or GPL-3,GPL-3 |
| `rsync` | `3.2.7-1+deb12u6` | GPL-3 |
| `sed` | `4.9-1+deb12u1` | BSD-4-clause-UC,BSL-1,GFDL-NIV-1.3+,GPL-3+,GPL-3+ and ISC,ISC,X11,pcre |
| `sshpass` | `1.09-1` | GPL-2+ |
| `sysvinit-utils` | `3.06-4` | GPL-2.0,GPL-2.0+,GPL-3.0 |
| `tar` | `1.34+dfsg-1.2+deb12u1` | GPL-2+,GPL-3+,GPL-3+ with Bison exception,LGPL-3+ |
| `tesseract-ocr` | `5.3.0-2` | Apache-2.0 |
| `tesseract-ocr-deu` | `1:4.1.0-2` | Apache-2.0 |
| `tesseract-ocr-eng` | `1:4.1.0-2` | Apache-2.0 |
| `tesseract-ocr-osd` | `1:4.1.0-2` | Apache-2.0 |
| `tzdata` | `2026b-0+deb12u1` | public-domain |
| `usr-is-merged` | `37~deb12u1` | GPL-2+ |
| `util-linux` | `2.38.1-5+deb12u3` | BSD-3-clause,BSD-4-clause,BSLA,GPL-2,GPL-2+,GPL-3+,LGPL,LGPL-2+,LGPL-2.1+,LGPL-3+,MIT,public-domain |
| `util-linux-extra` | `2.38.1-5+deb12u3` | BSD-3-clause,BSD-4-clause,BSLA,GPL-2,GPL-2+,GPL-3+,LGPL,LGPL-2+,LGPL-2.1+,LGPL-3+,MIT,public-domain |
| `zlib1g` | `1:1.2.13.dfsg-1` | Zlib |

## 3. libvips (über sharp)

Die Bildverarbeitung nutzt libvips. Das Paket `@img/sharp-libvips-*` bündelt
libvips mit seinen Abhängigkeiten; die folgenden stehen unter LGPLv3 (laut
Angabe des Paketautors, über die „any later version"-Klausel von LGPLv2/2.1):

| Bibliothek | Lizenz |
|---|---|
| libvips | LGPLv3 |
| glib | LGPLv3 |
| pango | LGPLv3 |
| librsvg | LGPLv3 |
| libheif | LGPLv3 |
| libexif | LGPLv3 |
| fribidi | LGPLv3 |
| proxy-libintl | LGPLv3 |
| cairo | MPL-2.0 |

Die übrigen gebündelten Bibliotheken (aom, cgif, expat, fontconfig, freetype,
harfbuzz, highway, lcms, libarchive, libffi, libimagequant, libnsgif, libpng,
libtiff, libultrahdr, libwebp, libxml2, mozjpeg, pixman, zlib-ng) stehen unter
BSD-, MIT- oder vergleichbaren Bedingungen. Die vollständige Aufstellung des
Paketautors liegt dem Paket bei und steht unter
<https://github.com/lovell/sharp-libvips>.

## 4. Weitere mitgelieferte Bestandteile

| Bestandteil | Lizenz | Quelle |
|---|---|---|
| Typst | Apache-2.0 | <https://github.com/typst/typst> |
| Tesseract OCR | Apache-2.0 | Debian-Paket `tesseract-ocr` |
| Source Sans 3 | SIL OFL 1.1 | `packages/documents/fonts/LICENSE-source-sans.md` |
| Source Serif 4 | SIL OFL 1.1 | `packages/documents/fonts/LICENSE-source-serif.md` |
| IBM Plex Mono | SIL OFL 1.1 | `packages/documents/fonts/LICENSE-ibm-plex-mono.txt` |

## 5. npm-Abhängigkeiten

Die folgenden Pakete liegen im Image unter `/app/node_modules`.

| Paket | Version | Lizenz |
|---|---|---|
| `@astrojs/compiler-binding` | `0.4.0` | MIT |
| `@astrojs/compiler-binding-linux-<plattform>` | `0.4.0` | MIT |
| `@astrojs/compiler-rs` | `0.4.0` | MIT |
| `@astrojs/internal-helpers` | `0.11.0` | MIT |
| `@astrojs/markdown-satteri` | `0.4.0` | MIT |
| `@astrojs/prism` | `4.0.2` | MIT |
| `@astrojs/sitemap` | `3.7.4` | MIT |
| `@astrojs/telemetry` | `3.3.3` | MIT |
| `@babel/code-frame` | `7.29.7` | MIT |
| `@babel/compat-data` | `7.29.7` | MIT |
| `@babel/core` | `7.29.7` | MIT |
| `@babel/generator` | `7.29.8` | MIT |
| `@babel/helper-compilation-targets` | `7.29.7` | MIT |
| `@babel/helper-globals` | `7.29.7` | MIT |
| `@babel/helper-module-imports` | `7.29.7` | MIT |
| `@babel/helper-module-transforms` | `7.29.7` | MIT |
| `@babel/helper-string-parser` | `7.29.7` | MIT |
| `@babel/helper-validator-identifier` | `7.29.7` | MIT |
| `@babel/helper-validator-option` | `7.29.7` | MIT |
| `@babel/helpers` | `7.29.7` | MIT |
| `@babel/parser` | `7.29.8` | MIT |
| `@babel/runtime` | `7.29.7` | MIT |
| `@babel/template` | `7.29.7` | MIT |
| `@babel/traverse` | `7.29.8` | MIT |
| `@babel/types` | `7.29.8` | MIT |
| `@base-ui/react` | `1.8.0` | MIT |
| `@base-ui/utils` | `0.4.0` | MIT |
| `@borewit/text-codec` | `0.2.2` | MIT |
| `@bruits/satteri-linux-<plattform>` | `0.10.5` | MIT |
| `@capsizecss/unpack` | `4.0.1` | MIT |
| `@clack/core` | `1.4.3` | MIT |
| `@clack/prompts` | `1.7.0` | MIT |
| `@eloqnt/config` | `0.1.0` | MIT |
| `@eloqnt/format-json` | `0.1.0` | MIT |
| `@eloqnt/format-po` | `0.1.0` | MIT |
| `@esbuild/linux-<plattform>` | `0.28.2` | MIT |
| `@floating-ui/core` | `1.8.0` | MIT |
| `@floating-ui/dom` | `1.8.0` | MIT |
| `@floating-ui/react-dom` | `2.1.9` | MIT |
| `@floating-ui/utils` | `0.2.12` | MIT |
| `@fontsource/ibm-plex-mono` | `5.3.0` | OFL-1.1 |
| `@fontsource/source-sans-3` | `5.3.0` | OFL-1.1 |
| `@fontsource/source-serif-4` | `5.3.0` | OFL-1.1 |
| `@formatjs/fast-memoize` | `3.1.7` | MIT |
| `@formatjs/icu-messageformat-parser` | `3.5.17` | MIT |
| `@formatjs/icu-skeleton-parser` | `2.1.11` | MIT |
| `@formatjs/intl-localematcher` | `0.8.13` | MIT |
| `@img/colour` | `1.1.0` | MIT |
| `@img/sharp-libvips-linux-<plattform>` | `1.3.3` | LGPL-3.0-or-later |
| `@img/sharp-linux-<plattform>` | `0.35.4` | Apache-2.0 |
| `@isaacs/fs-minipass` | `4.0.1` | ISC |
| `@jridgewell/gen-mapping` | `0.3.13` | MIT |
| `@jridgewell/remapping` | `2.3.5` | MIT |
| `@jridgewell/resolve-uri` | `3.1.2` | MIT |
| `@jridgewell/sourcemap-codec` | `1.6.0` | MIT |
| `@jridgewell/trace-mapping` | `0.3.31` | MIT |
| `@kompass/app` | `0.1.0` | unbekannt |
| `@kompass/markdown` | `0.1.0` | unbekannt |
| `@kompass/site-template` | `0.1.0` | unbekannt |
| `@modelcontextprotocol/core` | `2.0.0` | MIT |
| `@modelcontextprotocol/server` | `2.0.0` | MIT |
| `@next/env` | `16.3.4` | MIT |
| `@next/swc-linux-<plattform>` | `16.3.4` | MIT |
| `@node-rs/argon2` | `2.2.0` | MIT |
| `@node-rs/argon2-linux-<plattform>` | `2.2.0` | MIT |
| `@oslojs/encoding` | `1.1.0` | MIT |
| `@oxc-project/types` | `0.148.0` | MIT |
| `@parcel/watcher` | `2.6.0` | MIT |
| `@parcel/watcher-linux-<plattform>` | `2.6.0` | MIT |
| `@radix-ui/primitive` | `1.1.7` | MIT |
| `@radix-ui/react-compose-refs` | `1.1.5` | MIT |
| `@radix-ui/react-context` | `1.2.2` | MIT |
| `@radix-ui/react-dialog` | `1.1.23` | MIT |
| `@radix-ui/react-dismissable-layer` | `1.1.19` | MIT |
| `@radix-ui/react-focus-guards` | `1.1.6` | MIT |
| `@radix-ui/react-focus-scope` | `1.1.16` | MIT |
| `@radix-ui/react-id` | `1.1.4` | MIT |
| `@radix-ui/react-portal` | `1.1.17` | MIT |
| `@radix-ui/react-presence` | `1.1.10` | MIT |
| `@radix-ui/react-primitive` | `2.1.10` | MIT |
| `@radix-ui/react-slot` | `1.3.3` | MIT |
| `@radix-ui/react-use-callback-ref` | `1.1.4` | MIT |
| `@radix-ui/react-use-controllable-state` | `1.2.6` | MIT |
| `@radix-ui/react-use-effect-event` | `0.0.5` | MIT |
| `@radix-ui/react-use-layout-effect` | `1.1.4` | MIT |
| `@rolldown/binding-linux-<plattform>` | `1.2.7` | MIT |
| `@rolldown/pluginutils` | `1.0.1` | MIT |
| `@schummar/icu-type-parser` | `1.21.5` | MIT |
| `@shikijs/core` | `4.4.3` | MIT |
| `@shikijs/engine-javascript` | `4.4.3` | MIT |
| `@shikijs/engine-oniguruma` | `4.4.3` | MIT |
| `@shikijs/langs` | `4.4.3` | MIT |
| `@shikijs/primitive` | `4.4.3` | MIT |
| `@shikijs/themes` | `4.4.3` | MIT |
| `@shikijs/types` | `4.4.3` | MIT |
| `@shikijs/vscode-textmate` | `10.0.2` | MIT |
| `@swc/core` | `1.16.1` | Apache-2.0 |
| `@swc/core-linux-<plattform>` | `1.16.1` | Apache-2.0 AND MIT |
| `@swc/counter` | `0.1.3` | Apache-2.0 |
| `@swc/helpers` | `0.5.23` | Apache-2.0 |
| `@swc/types` | `0.1.28` | Apache-2.0 |
| `@tokenizer/inflate` | `0.4.1` | MIT |
| `@tokenizer/token` | `0.3.0` | MIT |
| `@types/better-sqlite3` | `9.6.0` | MIT |
| `@types/debug` | `4.1.13` | MIT |
| `@types/estree` | `1.0.9` | MIT |
| `@types/estree-jsx` | `1.0.5` | MIT |
| `@types/hast` | `3.0.5` | MIT |
| `@types/mdast` | `4.0.4` | MIT |
| `@types/ms` | `2.1.0` | MIT |
| `@types/nlcst` | `2.0.3` | MIT |
| `@types/node` | `24.13.3` | MIT |
| `@types/node` | `26.4.1` | MIT |
| `@types/react` | `19.2.18` | MIT |
| `@types/react-dom` | `19.2.7` | MIT |
| `@types/sax` | `1.2.7` | MIT |
| `@types/unist` | `2.0.11` | MIT |
| `@types/unist` | `3.0.3` | MIT |
| `@ungap/structured-clone` | `1.4.0` | ISC |
| `am-i-vibing` | `0.4.0` | MIT |
| `anymatch` | `3.1.3` | ISC |
| `arg` | `5.0.2` | MIT |
| `argparse` | `2.0.1` | Python-2.0 |
| `aria-hidden` | `1.2.6` | MIT |
| `aria-query` | `5.3.2` | Apache-2.0 |
| `astro` | `7.3.1` | MIT |
| `axobject-query` | `4.1.0` | Apache-2.0 |
| `bail` | `2.0.2` | MIT |
| `baseline-browser-mapping` | `2.11.21` | Apache-2.0 |
| `better-sqlite3` | `13.0.3` | MIT |
| `boolbase` | `1.0.0` | ISC |
| `browserslist` | `4.28.9` | MIT |
| `caniuse-lite` | `1.0.30001810` | CC-BY-4.0 |
| `ccount` | `2.0.1` | MIT |
| `character-entities` | `2.0.2` | MIT |
| `character-entities-html4` | `2.1.0` | MIT |
| `character-entities-legacy` | `3.0.0` | MIT |
| `character-reference-invalid` | `2.0.1` | MIT |
| `chokidar` | `5.0.0` | MIT |
| `chownr` | `3.0.0` | BlueOak-1.0.0 |
| `ci-info` | `4.4.0` | MIT |
| `class-variance-authority` | `0.7.1` | Apache-2.0 |
| `client-only` | `0.0.1` | MIT |
| `clsx` | `2.1.1` | MIT |
| `cmdk` | `1.1.1` | MIT |
| `cn` | `0.2.5` | MIT |
| `comma-separated-tokens` | `2.0.3` | MIT |
| `commander` | `11.1.0` | MIT |
| `common-ancestor-path` | `2.0.0` | BlueOak-1.0.0 |
| `content-type` | `2.1.0` | MIT |
| `convert-source-map` | `2.0.0` | MIT |
| `cookie` | `2.0.1` | MIT |
| `cookie-es` | `1.2.3` | MIT |
| `crossws` | `0.3.5` | MIT |
| `css-select` | `6.0.0` | BSD-2-Clause |
| `css-tree` | `2.2.1` | MIT |
| `css-tree` | `3.2.1` | MIT |
| `css-what` | `7.0.0` | BSD-2-Clause |
| `csso` | `5.0.5` | MIT |
| `csstype` | `3.2.3` | MIT |
| `debug` | `4.4.3` | MIT |
| `decode-named-character-reference` | `1.3.0` | MIT |
| `defu` | `6.1.7` | MIT |
| `dequal` | `2.0.3` | MIT |
| `destr` | `2.0.5` | MIT |
| `detect-libc` | `2.1.2` | Apache-2.0 |
| `detect-node-es` | `1.1.0` | MIT |
| `devalue` | `5.9.2` | MIT |
| `devlop` | `1.1.0` | MIT |
| `diff` | `9.0.0` | BSD-3-Clause |
| `dom-serializer` | `2.0.0` | MIT |
| `domelementtype` | `2.3.0` | BSD-2-Clause |
| `domhandler` | `5.0.3` | BSD-2-Clause |
| `domutils` | `3.2.2` | BSD-2-Clause |
| `drizzle-orm` | `0.45.2` | Apache-2.0 |
| `dset` | `3.1.4` | MIT |
| `electron-to-chromium` | `1.5.422` | ISC |
| `entities` | `4.5.0` | BSD-2-Clause |
| `es-module-lexer` | `2.3.2` | MIT |
| `esbuild` | `0.28.2` | MIT |
| `escalade` | `3.2.0` | MIT |
| `escape-string-regexp` | `5.0.0` | MIT |
| `eventemitter3` | `5.0.4` | MIT |
| `extend` | `3.0.2` | MIT |
| `fast-string-truncated-width` | `3.0.3` | MIT |
| `fast-string-width` | `3.0.2` | MIT |
| `fast-wrap-ansi` | `0.2.2` | MIT |
| `fdir` | `6.5.0` | MIT |
| `file-type` | `22.0.2` | MIT |
| `find-proc` | `0.1.0` | MIT |
| `flattie` | `1.1.1` | MIT |
| `fontace` | `0.4.1` | MIT |
| `fontkitten` | `1.0.3` | MIT |
| `gensync` | `1.0.0-beta.2` | MIT |
| `get-nonce` | `1.0.1` | MIT |
| `get-tsconfig` | `5.0.0-beta.4` | MIT |
| `github-slugger` | `2.0.0` | ISC |
| `h3` | `1.15.11` | MIT |
| `hast-util-sanitize` | `5.0.2` | MIT |
| `hast-util-to-html` | `9.0.5` | MIT |
| `hast-util-whitespace` | `3.0.0` | MIT |
| `html-escaper` | `3.0.3` | MIT |
| `html-void-elements` | `3.0.0` | MIT |
| `http-cache-semantics` | `4.2.0` | BSD-2-Clause |
| `icu-minify` | `4.14.2` | MIT |
| `ieee754` | `1.2.1` | BSD-3-Clause |
| `intl-messageformat` | `11.2.14` | BSD-3-Clause |
| `iron-webcrypto` | `1.2.1` | MIT |
| `is-alphabetical` | `2.0.1` | MIT |
| `is-alphanumerical` | `2.0.1` | MIT |
| `is-decimal` | `2.0.1` | MIT |
| `is-docker` | `4.0.0` | MIT |
| `is-extglob` | `2.1.1` | MIT |
| `is-glob` | `4.0.3` | MIT |
| `is-hexadecimal` | `2.0.1` | MIT |
| `is-plain-obj` | `4.1.0` | MIT |
| `jiti` | `2.7.0` | MIT |
| `js-tokens` | `4.0.0` | MIT |
| `js-yaml` | `4.3.2` | MIT |
| `jsesc` | `3.1.0` | MIT |
| `json5` | `2.2.3` | MIT |
| `jsonc-parser` | `3.3.1` | MIT |
| `lightningcss` | `1.33.0` | MPL-2.0 |
| `lightningcss-linux-<plattform>` | `1.33.0` | MPL-2.0 |
| `longest-streak` | `3.1.0` | MIT |
| `lru-cache` | `11.5.2` | BlueOak-1.0.0 |
| `lru-cache` | `5.1.1` | ISC |
| `lucide-react` | `1.41.0` | ISC |
| `magic-string` | `1.2.3` | MIT |
| `magicast` | `0.5.4` | MIT |
| `markdown-table` | `3.0.4` | MIT |
| `mdast-util-directive` | `3.1.0` | MIT |
| `mdast-util-find-and-replace` | `3.0.2` | MIT |
| `mdast-util-from-markdown` | `2.0.3` | MIT |
| `mdast-util-gfm` | `3.1.0` | MIT |
| `mdast-util-gfm-autolink-literal` | `2.0.1` | MIT |
| `mdast-util-gfm-footnote` | `2.1.0` | MIT |
| `mdast-util-gfm-strikethrough` | `2.0.0` | MIT |
| `mdast-util-gfm-table` | `2.0.0` | MIT |
| `mdast-util-gfm-task-list-item` | `2.0.0` | MIT |
| `mdast-util-phrasing` | `4.1.0` | MIT |
| `mdast-util-to-hast` | `13.2.1` | MIT |
| `mdast-util-to-markdown` | `2.1.2` | MIT |
| `mdast-util-to-string` | `4.0.0` | MIT |
| `mdn-data` | `2.0.28` | CC0-1.0 |
| `mdn-data` | `2.27.1` | CC0-1.0 |
| `micromark` | `4.0.2` | MIT |
| `micromark-core-commonmark` | `2.0.3` | MIT |
| `micromark-extension-directive` | `4.0.0` | MIT |
| `micromark-extension-gfm` | `3.0.0` | MIT |
| `micromark-extension-gfm-autolink-literal` | `2.1.0` | MIT |
| `micromark-extension-gfm-footnote` | `2.1.0` | MIT |
| `micromark-extension-gfm-strikethrough` | `2.1.0` | MIT |
| `micromark-extension-gfm-table` | `2.1.1` | MIT |
| `micromark-extension-gfm-tagfilter` | `2.0.0` | MIT |
| `micromark-extension-gfm-task-list-item` | `2.1.0` | MIT |
| `micromark-factory-destination` | `2.0.1` | MIT |
| `micromark-factory-label` | `2.0.1` | MIT |
| `micromark-factory-space` | `2.0.1` | MIT |
| `micromark-factory-title` | `2.0.1` | MIT |
| `micromark-factory-whitespace` | `2.0.1` | MIT |
| `micromark-util-character` | `2.1.1` | MIT |
| `micromark-util-chunked` | `2.0.1` | MIT |
| `micromark-util-classify-character` | `2.0.1` | MIT |
| `micromark-util-combine-extensions` | `2.0.1` | MIT |
| `micromark-util-decode-numeric-character-reference` | `2.0.2` | MIT |
| `micromark-util-decode-string` | `2.0.1` | MIT |
| `micromark-util-encode` | `2.0.1` | MIT |
| `micromark-util-html-tag-name` | `2.0.1` | MIT |
| `micromark-util-normalize-identifier` | `2.0.1` | MIT |
| `micromark-util-resolve-all` | `2.0.1` | MIT |
| `micromark-util-sanitize-uri` | `2.0.1` | MIT |
| `micromark-util-subtokenize` | `2.1.0` | MIT |
| `micromark-util-symbol` | `2.0.1` | MIT |
| `micromark-util-types` | `2.0.2` | MIT |
| `minipass` | `7.1.3` | BlueOak-1.0.0 |
| `minizlib` | `3.1.0` | MIT |
| `mrmime` | `2.0.1` | MIT |
| `ms` | `2.1.3` | MIT |
| `nanoid` | `3.3.18` | MIT |
| `negotiator` | `1.1.0` | MIT |
| `neotraverse` | `1.0.1` | MIT |
| `next` | `16.3.4` | MIT |
| `next-intl` | `4.14.2` | MIT |
| `next-intl-swc-plugin-extractor` | `4.14.2` | MIT |
| `next-themes` | `0.4.6` | MIT |
| `nlcst-to-string` | `4.0.0` | MIT |
| `node-addon-api` | `7.1.1` | MIT |
| `node-addon-api` | `8.9.2` | MIT |
| `node-fetch-native` | `1.6.7` | MIT |
| `node-mock-http` | `1.0.5` | MIT |
| `node-releases` | `2.0.54` | MIT |
| `normalize-path` | `3.0.0` | MIT |
| `nth-check` | `2.1.1` | BSD-2-Clause |
| `obug` | `2.1.4` | MIT |
| `ofetch` | `1.5.1` | MIT |
| `ohash` | `2.0.12` | MIT |
| `oniguruma-parser` | `0.12.2` | MIT |
| `oniguruma-to-es` | `4.3.6` | MIT |
| `p-limit` | `7.3.2` | MIT |
| `p-queue` | `9.3.3` | MIT |
| `p-timeout` | `7.0.1` | MIT |
| `package-manager-detector` | `1.8.0` | MIT |
| `parse-entities` | `4.0.2` | MIT |
| `piccolore` | `0.1.3` | ISC |
| `picocolors` | `1.1.1` | ISC |
| `picomatch` | `2.3.2` | MIT |
| `picomatch` | `4.0.7` | MIT |
| `po-parser` | `2.2.0` | MIT |
| `postcss` | `8.5.23` | MIT |
| `postcss` | `8.5.28` | MIT |
| `prismjs` | `1.30.0` | MIT |
| `process-ancestry` | `0.1.0` | MIT |
| `property-information` | `7.2.0` | MIT |
| `radix3` | `1.1.2` | MIT |
| `react` | `19.2.8` | MIT |
| `react-dom` | `19.2.8` | MIT |
| `react-remove-scroll` | `2.7.2` | MIT |
| `react-remove-scroll-bar` | `2.3.8` | MIT |
| `react-style-singleton` | `2.2.3` | MIT |
| `readdirp` | `5.1.1` | MIT |
| `regex` | `6.1.0` | MIT |
| `regex-recursion` | `6.0.2` | MIT |
| `regex-utilities` | `2.3.0` | MIT |
| `rehype-sanitize` | `6.0.0` | MIT |
| `rehype-stringify` | `10.0.1` | MIT |
| `remark-directive` | `4.0.0` | MIT |
| `remark-gfm` | `4.0.1` | MIT |
| `remark-parse` | `11.0.0` | MIT |
| `remark-rehype` | `11.1.2` | MIT |
| `remark-stringify` | `11.0.0` | MIT |
| `reselect` | `5.3.0` | MIT |
| `resolve-pkg-maps` | `1.0.0` | MIT |
| `retext-smartypants` | `6.2.0` | MIT |
| `rolldown` | `1.2.7` | MIT |
| `satteri` | `0.10.5` | MIT |
| `sax` | `1.6.1` | BlueOak-1.0.0 |
| `scheduler` | `0.27.0` | MIT |
| `semver` | `6.3.1` | ISC |
| `semver` | `7.8.5` | ISC |
| `server-only` | `0.0.1` | MIT |
| `sharp` | `0.35.4` | Apache-2.0 |
| `shiki` | `4.4.3` | MIT |
| `sisteransi` | `1.0.5` | MIT |
| `sitemap` | `9.0.1` | MIT |
| `smol-toml` | `1.8.0` | BSD-3-Clause |
| `sonner` | `2.0.8` | MIT |
| `source-map-js` | `1.2.1` | BSD-3-Clause |
| `space-separated-tokens` | `2.0.2` | MIT |
| `stringify-entities` | `4.0.4` | MIT |
| `strtok3` | `10.3.5` | MIT |
| `styled-jsx` | `5.1.6` | MIT |
| `svgo` | `4.1.0` | MIT |
| `tailwind-merge` | `3.6.0` | MIT |
| `tar` | `7.5.22` | BlueOak-1.0.0 |
| `tiny-inflate` | `1.0.3` | MIT |
| `tinyclip` | `0.1.15` | MIT |
| `tinyexec` | `1.3.0` | MIT |
| `tinyglobby` | `0.2.17` | MIT |
| `token-types` | `6.1.2` | MIT |
| `trim-lines` | `3.0.1` | MIT |
| `trough` | `2.2.0` | MIT |
| `tslib` | `2.8.1` | 0BSD |
| `tw-animate-css` | `1.4.0` | MIT |
| `ufo` | `1.6.4` | MIT |
| `uint8array-extras` | `1.5.0` | MIT |
| `ulid` | `3.0.2` | MIT |
| `ultrahtml` | `1.7.0` | MIT |
| `uncrypto` | `0.1.3` | MIT |
| `undici` | `8.10.2` | MIT |
| `undici-types` | `7.18.2` | MIT |
| `undici-types` | `8.3.0` | MIT |
| `unified` | `11.0.5` | MIT |
| `unifont` | `0.7.5` | MIT |
| `unist-util-is` | `6.0.1` | MIT |
| `unist-util-position` | `5.0.0` | MIT |
| `unist-util-stringify-position` | `4.0.0` | MIT |
| `unist-util-visit` | `5.1.0` | MIT |
| `unist-util-visit-parents` | `6.0.2` | MIT |
| `unstorage` | `1.17.5` | MIT |
| `update-browserslist-db` | `1.3.2` | MIT |
| `use-callback-ref` | `1.3.3` | MIT |
| `use-intl` | `4.14.2` | MIT |
| `use-sidecar` | `1.1.3` | MIT |
| `use-sync-external-store` | `1.6.0` | MIT |
| `verein-basis` | `0.1.0` | unbekannt |
| `vfile` | `6.0.3` | MIT |
| `vfile-message` | `4.0.3` | MIT |
| `vite` | `8.2.2` | MIT |
| `vitefu` | `1.1.3` | MIT |
| `xxhash-wasm` | `1.1.0` | MIT |
| `yallist` | `3.1.1` | ISC |
| `yallist` | `5.0.0` | BlueOak-1.0.0 |
| `yaml` | `2.9.0` | ISC |
| `yargs-parser` | `22.0.0` | ISC |
| `yocto-queue` | `1.2.2` | MIT |
| `zod` | `4.5.4` | MIT |
| `zwitch` | `2.0.4` | MIT |
