# Hinweise zu Software Dritter

Aluna Kompass steht unter Apache-2.0 (siehe `LICENSE` und `NOTICE`). Das
ausgelieferte Container-Image enthält darüber hinaus Software Dritter unter
eigenen Bedingungen. Diese Datei führt sie auf.

**Diese Datei wird erzeugt, nicht gepflegt.** Quelle ist das gebaute Image:

```
scripts/third-party-notices.sh [image]
```

Stand: Debian 12.15, 167 Systempakete, 962 npm-Pakete.

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
| `bash` | `5.2.15-2+b13` | BSD-4-clause-UC,BSD-4-clause-UC and MIT-like,GFDL-NIV-1.3,GPL-2+,GPL-3+,GPL-3+ with Bison exception,Latex2e,MIT-like,permissive |
| `bsdutils` | `1:2.38.1-5+deb12u3` | BSD-3-clause,BSD-4-clause,BSLA,GPL-2,GPL-2+,GPL-3+,LGPL,LGPL-2+,LGPL-2.1+,LGPL-3+,MIT,public-domain |
| `ca-certificates` | `20250419~deb12u1` | GPL-2+,MPL-2.0 |
| `coreutils` | `9.1-1` | BSD-4-clause-UC,FSFULLR,GFDL-NIV-1.3,GPL-3+,GPL-3+ and BSD-4-clause-UC,GPL-3+ and ISC,ISC |
| `dash` | `0.5.12-2` | BSD-3-Clause,BSD-3-clause,GPL-2+,public-domain |
| `debconf` | `1.5.82` | BSD-2-clause |
| `debian-archive-keyring` | `2023.3+deb12u2` | GPL |
| `debianutils` | `5.7-0.5~deb12u1` | GPL-2+,SMAIL-GPL,public-domain |
| `diffutils` | `1:3.8-4` | FSFAP,FSFULLR,GFDL-NIV-1.3,GPL-2+,GPL-3+,GPL-3+ and FSFULLR,GPL-3+ with autoconf exception,GPL-3+ with texinfo exception,LGPL-2.0+,LGPL-2.1+,LGPL-3.0+,LGPL-3.0+ or GPL-2+,X11,public-domain |
| `dpkg` | `1.21.23` | BSD-2-clause,GPL-2,GPL-2+,public-domain-s-s-d |
| `e2fsprogs` | `1.47.0-2+b2` | Apache-2,BSD-3-Clause,GPL or MIT-US-export,GPL-2,GPL-2+ with Texinfo exception,ISC,Kazlib,LGPL-2,Latex2e |
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
| `libbrotli1` | `1.0.9-2+b6` | MIT |
| `libbsd0` | `0.11.7-2` | BSD-2-clause,BSD-2-clause-NetBSD,BSD-2-clause-author,BSD-2-clause-verbatim,BSD-3-clause,BSD-3-clause-John-Birrell,BSD-3-clause-Regents,BSD-3-clause-Regents and BSD-2-clause-NetBSD,BSD-3-clause-author,BSD-4-clause-Niels-Provos,Beerware,Expat,ISC,ISC-Original,libutil-David-Nugent,public-domain |
| `libbz2-1.0` | `1.0.8-5+b1` | BSD-variant,GPL-2 |
| `libc-bin` | `2.36-9+deb12u14` | GPL-2,LGPL-2.1 |
| `libc6` | `2.36-9+deb12u14` | GPL-2,LGPL-2.1 |
| `libcairo2` | `1.16.0-7` | LGPL-2.1 |
| `libcap-ng0` | `0.8.3-1+b3` | GPL-2+,GPL-3,LGPL-2.1+ |
| `libcap2` | `1:2.66-4+deb12u3+b1` | BSD-3-clause,BSD-3-clause or GPL-2,BSD-3-clause or GPL-2+,GPL-2,GPL-2+ |
| `libcbor0.8` | `0.8.0-2+b1` | Expat |
| `libcom-err2` | `1.47.0-2+b2` | Apache-2,BSD-3-Clause,GPL or MIT-US-export,GPL-2,GPL-2+ with Texinfo exception,ISC,Kazlib,LGPL-2,Latex2e |
| `libcrypt1` | `1:4.4.33-2` | siehe /usr/share/doc/libcrypt1/copyright |
| `libcurl4` | `7.88.1-10+deb12u15` | BSD-3-Clause,BSD-3-clause,BSD-4-Clause-UC,FSFULLR,GPL-2+ with Autoconf-data exception,GPL-2+ with Libtool exception,GPL-3+ with Autoconf-data exception,ISC,OLDAP-2.8,X11,curl |
| `libdatrie1` | `0.2.13-2+b1` | GPL-2+,LGPL-2.1+ |
| `libdb5.3` | `5.3.28+dfsg2-1` | Artistic or BSD-3-clause,BSD-3-clause,BSD-3-clause-fjord,GPL,GPL or Artistic,GPL-3,MIT-old,Ms-PL,Sleepycat,Sleepycat and BSD-3-clause,TCL-like,X11,zlib |
| `libdebconfclient0` | `0.270` | BSD-2-Clause,BSD-2-clause,GPL-2+ |
| `libdeflate0` | `1.14-1` | Expat |
| `libedit2` | `3.1-20221030-2` | BSD-3-clause |
| `libexpat1` | `2.5.0-1+deb12u3` | MIT |
| `libext2fs2` | `1.47.0-2+b2` | Apache-2,BSD-3-Clause,GPL or MIT-US-export,GPL-2,GPL-2+ with Texinfo exception,ISC,Kazlib,LGPL-2,Latex2e |
| `libffi8` | `3.4.4-1` | Expat,GPL,GPL-2+,GPL-3+,MPL-1.1 or GPL-2+ or LGPL-2.1+,X11,public-domain |
| `libfido2-1` | `1.12.0-2+b1` | BSD-2-clause,ISC,ISC and BSD-2-clause,public-domain |
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
| `libidn2-0` | `2.3.3-1+b1` | GPL-2+,GPL-3+,LGPL-3+,LGPL-3+ or GPL-2+,Unicode |
| `libjbig0` | `2.1-6.1` | GPL-2+ |
| `libjpeg62-turbo` | `1:2.1.5-2` | BSD-3-clause,BSD-BY-LC-NE,Expat,License:zlib,NTP,Zlib |
| `libk5crypto3` | `1.20.1-2+deb12u5` | GPL-2 |
| `libkeyutils1` | `1.6.3-2` | GPL-2+,LGPL-2+ |
| `libkrb5-3` | `1.20.1-2+deb12u5` | GPL-2 |
| `libkrb5support0` | `1.20.1-2+deb12u5` | GPL-2 |
| `liblcms2-2` | `2.14-2+deb12u1` | GPL-2+,GPL-3,IJG,MIT |
| `libldap-2.5-0` | `2.5.13+dfsg-5` | BSD-3-clause,BSD-3-clause-California,BSD-3-clause-variant,BSD-4-clause-California,Beerware,Expat,Expat-ISC,Expat-UNM,F5,FSF-unlimited,FSF-unlimited and GPL-2+ with Autoconf exception,FSF-unlimited and GPL-2+ with Libtool exception,FSF-unlimited and OpenLDAP-2.8,GPL-2+,GPL-2+ with Autoconf exception,GPL-2+ with Libtool exception,GPL-2+ with Libtool exception and GPL-3+ with Libtool exception and GPL-3+,GPL-3+,GPL-3+ with Autoconf exception,GPL-3+ with Libtool exception,JCG,MIT-XC,NeoSoft-permissive,OpenLDAP-2.8,OpenLDAP-2.8 and BSD-3-clause,OpenLDAP-2.8 and BSD-3-clause-variant,OpenLDAP-2.8 and BSD-4-clause-California,OpenLDAP-2.8 and Beerware,OpenLDAP-2.8 and Expat,OpenLDAP-2.8 and Expat-ISC,OpenLDAP-2.8 and Expat-UNM,OpenLDAP-2.8 and FSF-unlimited and GPL-2+ with Libtool exception,OpenLDAP-2.8 and JCG and UMich,OpenLDAP-2.8 and UMich,OpenLDAP-2.8 and UMich and F5,UMich,public-domain |
| `liblept5` | `1.82.0-3+b3` | License: |
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
| `librtmp1` | `2.4+20151223.gitfa8646d.1-2+b2` | GPL-2,LGPL-2.1 |
| `libsasl2-2` | `2.1.28+dfsg-10` | BSD-2-clause,BSD-2-clause and MIT-CMU,BSD-2.2-clause,BSD-3-clause,BSD-3-clause-JANET,BSD-3-clause-JANET and BSD-4-clause,BSD-3-clause-PADL,BSD-3-clause-PADL and MIT-OpenVision,BSD-4-clause,BSD-4-clause and BSD-4-clause-KTH,BSD-4-clause and IBM-as-is,BSD-4-clause and MIT-Export,BSD-4-clause-KTH,BSD-4-clause-UC,FSFULLR,FSFULLR and MIT-CMU,GPL-3,GPL-3+,IBM-as-is,MIT-CMU,MIT-Export,MIT-OpenVision,OpenLDAP,OpenSSL,OpenSSL and SSLeay,RSA-MD,SSLeay |
| `libsasl2-modules-db` | `2.1.28+dfsg-10` | BSD-2-clause,BSD-2-clause and MIT-CMU,BSD-2.2-clause,BSD-3-clause,BSD-3-clause-JANET,BSD-3-clause-JANET and BSD-4-clause,BSD-3-clause-PADL,BSD-3-clause-PADL and MIT-OpenVision,BSD-4-clause,BSD-4-clause and BSD-4-clause-KTH,BSD-4-clause and IBM-as-is,BSD-4-clause and MIT-Export,BSD-4-clause-KTH,BSD-4-clause-UC,FSFULLR,FSFULLR and MIT-CMU,GPL-3,GPL-3+,IBM-as-is,MIT-CMU,MIT-Export,MIT-OpenVision,OpenLDAP,OpenSSL,OpenSSL and SSLeay,RSA-MD,SSLeay |
| `libseccomp2` | `2.5.4-1+deb12u1` | LGPL-2.1 |
| `libselinux1` | `3.4-1+b6` | GPL-2,LGPL-2.1 |
| `libsemanage-common` | `3.4-1` | GPL,LGPL |
| `libsemanage2` | `3.4-1+b5` | GPL,LGPL |
| `libsepol2` | `3.4-2.1` | GPL-2,GPL-2+,LGPL-2.1+,Zlib |
| `libsmartcols1` | `2.38.1-5+deb12u3` | BSD-3-clause,BSD-4-clause,BSLA,GPL-2,GPL-2+,GPL-3+,LGPL,LGPL-2+,LGPL-2.1+,LGPL-3+,MIT,public-domain |
| `libsqlite3-0` | `3.40.1-2+deb12u2` | GPL-2+,public-domain |
| `libss2` | `1.47.0-2+b2` | Apache-2,BSD-3-Clause,GPL or MIT-US-export,GPL-2,GPL-2+ with Texinfo exception,ISC,Kazlib,LGPL-2,Latex2e |
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
| `libxext6` | `2:1.3.4-1+b1` | siehe /usr/share/doc/libxext6/copyright |
| `libxml2` | `2.9.14+dfsg-1.3~deb12u6` | ISC,MIT-1 |
| `libxrender1` | `1:0.9.10-1.1` | siehe /usr/share/doc/libxrender1/copyright |
| `libxxhash0` | `0.8.1-1` | BSD-2-clause,GPL-2 |
| `libzstd1` | `1.5.4+dfsg2-5` | BSD-3-clause,BSD-3-clause or GPL-2,Expat,GPL-2,zlib |
| `login` | `1:4.13+dfsg1-1+deb12u2` | BSD-3-clause,GPL-1,GPL-2+,public-domain |
| `logsave` | `1.47.0-2+b2` | Apache-2,BSD-3-Clause,GPL or MIT-US-export,GPL-2,GPL-2+ with Texinfo exception,ISC,Kazlib,LGPL-2,Latex2e |
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
| `@alloc/quick-lru` | `5.3.0` | MIT |
| `@astrojs/check` | `0.9.10` | MIT |
| `@astrojs/compiler` | `2.13.1` | MIT |
| `@astrojs/compiler-binding` | `0.4.0` | MIT |
| `@astrojs/compiler-binding-linux-arm64-gnu` | `0.4.0` | MIT |
| `@astrojs/compiler-rs` | `0.4.0` | MIT |
| `@astrojs/internal-helpers` | `0.11.0` | MIT |
| `@astrojs/language-server` | `2.16.16` | MIT |
| `@astrojs/markdown-satteri` | `0.4.0` | MIT |
| `@astrojs/prism` | `4.0.2` | MIT |
| `@astrojs/sitemap` | `3.7.4` | MIT |
| `@astrojs/telemetry` | `3.3.3` | MIT |
| `@astrojs/yaml2ts` | `0.2.4` | MIT |
| `@babel/code-frame` | `7.29.7` | MIT |
| `@babel/compat-data` | `7.29.7` | MIT |
| `@babel/core` | `7.29.7` | MIT |
| `@babel/generator` | `7.29.8` | MIT |
| `@babel/helper-annotate-as-pure` | `7.29.7` | MIT |
| `@babel/helper-compilation-targets` | `7.29.7` | MIT |
| `@babel/helper-create-class-features-plugin` | `7.29.7` | MIT |
| `@babel/helper-globals` | `7.29.7` | MIT |
| `@babel/helper-member-expression-to-functions` | `7.29.7` | MIT |
| `@babel/helper-module-imports` | `7.29.7` | MIT |
| `@babel/helper-module-transforms` | `7.29.7` | MIT |
| `@babel/helper-optimise-call-expression` | `7.29.7` | MIT |
| `@babel/helper-plugin-utils` | `7.29.7` | MIT |
| `@babel/helper-replace-supers` | `7.29.7` | MIT |
| `@babel/helper-skip-transparent-expression-wrappers` | `7.29.7` | MIT |
| `@babel/helper-string-parser` | `7.29.7` | MIT |
| `@babel/helper-validator-identifier` | `7.29.7` | MIT |
| `@babel/helper-validator-option` | `7.29.7` | MIT |
| `@babel/helpers` | `7.29.7` | MIT |
| `@babel/parser` | `7.29.8` | MIT |
| `@babel/plugin-syntax-jsx` | `7.29.7` | MIT |
| `@babel/plugin-syntax-typescript` | `7.29.7` | MIT |
| `@babel/plugin-transform-modules-commonjs` | `7.29.7` | MIT |
| `@babel/plugin-transform-typescript` | `7.29.7` | MIT |
| `@babel/preset-typescript` | `7.29.7` | MIT |
| `@babel/runtime` | `7.29.7` | MIT |
| `@babel/template` | `7.29.7` | MIT |
| `@babel/traverse` | `7.29.8` | MIT |
| `@babel/types` | `7.29.8` | MIT |
| `@base-ui/react` | `1.8.0` | MIT |
| `@base-ui/utils` | `0.4.0` | MIT |
| `@borewit/text-codec` | `0.2.2` | MIT |
| `@bruits/satteri-linux-arm64-gnu` | `0.10.5` | MIT |
| `@cacheable/memory` | `2.2.0` | MIT |
| `@cacheable/utils` | `2.5.0` | MIT |
| `@capsizecss/unpack` | `4.0.1` | MIT |
| `@clack/core` | `1.4.3` | MIT |
| `@clack/prompts` | `1.7.0` | MIT |
| `@dotenvx/dotenvx` | `1.75.1` | BSD-3-Clause |
| `@dotenvx/primitives` | `0.8.0` | BSD-3-Clause |
| `@drizzle-team/brocli` | `0.10.2` | Apache-2.0 |
| `@eloqnt/config` | `0.1.0` | MIT |
| `@eloqnt/format-json` | `0.1.0` | MIT |
| `@eloqnt/format-po` | `0.1.0` | MIT |
| `@emmetio/abbreviation` | `2.3.3` | MIT |
| `@emmetio/css-abbreviation` | `2.1.8` | MIT |
| `@emmetio/css-parser` | `0.4.1` | MIT |
| `@emmetio/html-matcher` | `1.3.0` | ISC |
| `@emmetio/scanner` | `1.0.4` | MIT |
| `@emmetio/stream-reader` | `2.2.0` | MIT |
| `@emmetio/stream-reader-utils` | `0.1.0` | MIT |
| `@esbuild-kit/core-utils` | `3.3.2` | MIT |
| `@esbuild-kit/esm-loader` | `2.6.5` | MIT |
| `@esbuild/linux-arm64` | `0.18.20` | MIT |
| `@esbuild/linux-arm64` | `0.25.12` | MIT |
| `@esbuild/linux-arm64` | `0.28.2` | MIT |
| `@eslint-community/eslint-utils` | `4.10.1` | MIT |
| `@eslint-community/eslint-utils` | `4.9.1` | MIT |
| `@eslint-community/regexpp` | `4.12.2` | MIT |
| `@eslint/config-array` | `0.23.5` | Apache-2.0 |
| `@eslint/config-helpers` | `0.7.0` | Apache-2.0 |
| `@eslint/core` | `1.2.1` | Apache-2.0 |
| `@eslint/object-schema` | `3.0.5` | Apache-2.0 |
| `@eslint/plugin-kit` | `0.7.3` | Apache-2.0 |
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
| `@hono/node-server` | `2.1.1` | MIT |
| `@humanfs/core` | `0.19.2` | Apache-2.0 |
| `@humanfs/node` | `0.16.8` | Apache-2.0 |
| `@humanfs/types` | `0.15.0` | Apache-2.0 |
| `@humanwhocodes/module-importer` | `1.0.1` | Apache-2.0 |
| `@humanwhocodes/retry` | `0.4.3` | Apache-2.0 |
| `@img/colour` | `1.1.0` | MIT |
| `@img/sharp-libvips-linux-arm64` | `1.3.3` | LGPL-3.0-or-later |
| `@img/sharp-linux-arm64` | `0.35.4` | Apache-2.0 |
| `@isaacs/fs-minipass` | `4.0.1` | ISC |
| `@jridgewell/gen-mapping` | `0.3.13` | MIT |
| `@jridgewell/remapping` | `2.3.5` | MIT |
| `@jridgewell/resolve-uri` | `3.1.2` | MIT |
| `@jridgewell/sourcemap-codec` | `1.6.0` | MIT |
| `@jridgewell/trace-mapping` | `0.3.31` | MIT |
| `@keyv/bigmap` | `1.3.1` | MIT |
| `@keyv/serialize` | `1.1.1` | MIT |
| `@kompass/app` | `0.1.0` | unbekannt |
| `@kompass/markdown` | `0.1.0` | unbekannt |
| `@kompass/site-template` | `0.1.0` | unbekannt |
| `@modelcontextprotocol/client` | `2.0.0` | MIT |
| `@modelcontextprotocol/core` | `2.0.0` | MIT |
| `@modelcontextprotocol/sdk` | `1.30.0` | MIT |
| `@modelcontextprotocol/server` | `2.0.0` | MIT |
| `@next/env` | `16.3.4` | MIT |
| `@next/eslint-plugin-next` | `16.3.4` | MIT |
| `@next/swc-linux-arm64-gnu` | `16.3.4` | MIT |
| `@node-rs/argon2` | `2.2.0` | MIT |
| `@node-rs/argon2-linux-arm64-gnu` | `2.2.0` | MIT |
| `@nodelib/fs.scandir` | `2.1.5` | MIT |
| `@nodelib/fs.stat` | `2.0.5` | MIT |
| `@nodelib/fs.walk` | `1.2.8` | MIT |
| `@nolyfill/is-core-module` | `1.0.39` | MIT |
| `@oslojs/encoding` | `1.1.0` | MIT |
| `@oxc-project/types` | `0.148.0` | MIT |
| `@parcel/watcher` | `2.6.0` | MIT |
| `@parcel/watcher-linux-arm64-glibc` | `2.6.0` | MIT |
| `@playwright/test` | `1.63.0` | Apache-2.0 |
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
| `@rolldown/binding-linux-arm64-gnu` | `1.2.7` | MIT |
| `@rolldown/pluginutils` | `1.0.1` | MIT |
| `@rtsao/scc` | `1.1.0` | MIT |
| `@schummar/icu-type-parser` | `1.21.5` | MIT |
| `@sec-ant/readable-stream` | `0.4.1` | MIT |
| `@shikijs/core` | `4.4.3` | MIT |
| `@shikijs/engine-javascript` | `4.4.3` | MIT |
| `@shikijs/engine-oniguruma` | `4.4.3` | MIT |
| `@shikijs/langs` | `4.4.3` | MIT |
| `@shikijs/primitive` | `4.4.3` | MIT |
| `@shikijs/themes` | `4.4.3` | MIT |
| `@shikijs/types` | `4.4.3` | MIT |
| `@shikijs/vscode-textmate` | `10.0.2` | MIT |
| `@sindresorhus/merge-streams` | `4.0.0` | MIT |
| `@swc/core` | `1.16.1` | Apache-2.0 |
| `@swc/core-linux-arm64-gnu` | `1.16.1` | Apache-2.0 AND MIT |
| `@swc/counter` | `0.1.3` | Apache-2.0 |
| `@swc/helpers` | `0.5.23` | Apache-2.0 |
| `@swc/types` | `0.1.28` | Apache-2.0 |
| `@tailwindcss/node` | `4.3.3` | MIT |
| `@tailwindcss/oxide` | `4.3.3` | MIT |
| `@tailwindcss/oxide-linux-arm64-gnu` | `4.3.3` | MIT |
| `@tailwindcss/postcss` | `4.3.3` | MIT |
| `@tokenizer/inflate` | `0.4.1` | MIT |
| `@tokenizer/token` | `0.3.0` | MIT |
| `@ts-morph/common` | `0.27.0` | MIT |
| `@types/better-sqlite3` | `9.6.0` | MIT |
| `@types/chai` | `5.2.3` | MIT |
| `@types/debug` | `4.1.13` | MIT |
| `@types/deep-eql` | `4.0.2` | MIT |
| `@types/esrecurse` | `4.3.1` | MIT |
| `@types/estree` | `1.0.9` | MIT |
| `@types/estree-jsx` | `1.0.5` | MIT |
| `@types/hast` | `3.0.5` | MIT |
| `@types/json-schema` | `7.0.15` | MIT |
| `@types/json5` | `0.0.29` | MIT |
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
| `@types/validate-npm-package-name` | `4.0.2` | MIT |
| `@typescript-eslint/eslint-plugin` | `8.69.0` | MIT |
| `@typescript-eslint/parser` | `8.69.0` | MIT |
| `@typescript-eslint/project-service` | `8.69.0` | MIT |
| `@typescript-eslint/scope-manager` | `8.69.0` | MIT |
| `@typescript-eslint/tsconfig-utils` | `8.69.0` | MIT |
| `@typescript-eslint/type-utils` | `8.69.0` | MIT |
| `@typescript-eslint/types` | `8.69.0` | MIT |
| `@typescript-eslint/typescript-estree` | `8.69.0` | MIT |
| `@typescript-eslint/utils` | `8.69.0` | MIT |
| `@typescript-eslint/visitor-keys` | `8.69.0` | MIT |
| `@ungap/structured-clone` | `1.4.0` | ISC |
| `@unrs/resolver-binding-linux-arm64-gnu` | `1.12.2` | MIT |
| `@vitest/mocker` | `5.0.0` | MIT |
| `@vitest/spy` | `5.0.0` | MIT |
| `@volar/kit` | `2.4.28` | MIT |
| `@volar/language-core` | `2.4.28` | MIT |
| `@volar/language-server` | `2.4.28` | MIT |
| `@volar/language-service` | `2.4.28` | MIT |
| `@volar/source-map` | `2.4.28` | MIT |
| `@volar/typescript` | `2.4.28` | MIT |
| `@vscode/emmet-helper` | `2.11.0` | MIT |
| `@vscode/l10n` | `0.0.18` | MIT |
| `accepts` | `2.0.0` | MIT |
| `acorn` | `8.18.0` | MIT |
| `acorn-jsx` | `5.3.2` | MIT |
| `ajv` | `6.15.0` | MIT |
| `ajv` | `8.20.0` | MIT |
| `ajv-draft-04` | `1.0.0` | MIT |
| `ajv-formats` | `2.1.1` | MIT |
| `ajv-formats` | `3.0.1` | MIT |
| `ajv-i18n` | `4.2.0` | MIT |
| `am-i-vibing` | `0.4.0` | MIT |
| `ansi-colors` | `4.1.3` | MIT |
| `ansi-regex` | `5.0.1` | MIT |
| `ansi-regex` | `6.3.0` | MIT |
| `ansi-styles` | `6.2.3` | MIT |
| `anymatch` | `3.1.3` | ISC |
| `arg` | `5.0.2` | MIT |
| `argparse` | `2.0.1` | Python-2.0 |
| `aria-hidden` | `1.2.6` | MIT |
| `aria-query` | `5.3.2` | Apache-2.0 |
| `array-buffer-byte-length` | `1.0.2` | MIT |
| `array-includes` | `3.1.9` | MIT |
| `array.prototype.findlast` | `1.2.5` | MIT |
| `array.prototype.findlastindex` | `1.2.6` | MIT |
| `array.prototype.flat` | `1.3.3` | MIT |
| `array.prototype.flatmap` | `1.3.3` | MIT |
| `array.prototype.tosorted` | `1.1.4` | MIT |
| `arraybuffer.prototype.slice` | `1.0.4` | MIT |
| `assertion-error` | `2.0.1` | MIT |
| `ast-types` | `0.16.3` | MIT |
| `ast-types-flow` | `0.0.8` | MIT |
| `astro` | `7.3.1` | MIT |
| `async-function` | `1.0.0` | MIT |
| `atomically` | `1.7.0` | MIT |
| `available-typed-arrays` | `1.0.7` | MIT |
| `axe-core` | `4.13.0` | MPL-2.0 |
| `axobject-query` | `4.1.0` | Apache-2.0 |
| `bail` | `2.0.2` | MIT |
| `balanced-match` | `1.0.2` | MIT |
| `balanced-match` | `4.0.4` | MIT |
| `baseline-browser-mapping` | `2.11.21` | Apache-2.0 |
| `better-sqlite3` | `13.0.3` | MIT |
| `body-parser` | `2.3.0` | MIT |
| `boolbase` | `1.0.0` | ISC |
| `brace-expansion` | `1.1.18` | MIT |
| `brace-expansion` | `5.0.9` | MIT |
| `braces` | `3.0.3` | MIT |
| `browserslist` | `4.28.9` | MIT |
| `buffer-from` | `1.1.2` | MIT |
| `bundle-name` | `4.1.0` | MIT |
| `bytes` | `3.1.2` | MIT |
| `cacheable` | `2.5.0` | MIT |
| `call-bind` | `1.0.9` | MIT |
| `call-bind-apply-helpers` | `1.0.2` | MIT |
| `call-bound` | `1.0.4` | MIT |
| `callsites` | `3.1.0` | MIT |
| `caniuse-lite` | `1.0.30001810` | CC-BY-4.0 |
| `ccount` | `2.0.1` | MIT |
| `chai` | `6.2.2` | MIT |
| `chalk` | `5.6.2` | MIT |
| `character-entities` | `2.0.2` | MIT |
| `character-entities-html4` | `2.1.0` | MIT |
| `character-entities-legacy` | `3.0.0` | MIT |
| `character-reference-invalid` | `2.0.1` | MIT |
| `chokidar` | `4.0.3` | MIT |
| `chokidar` | `5.0.0` | MIT |
| `chownr` | `3.0.0` | BlueOak-1.0.0 |
| `ci-info` | `4.4.0` | MIT |
| `class-variance-authority` | `0.7.1` | Apache-2.0 |
| `cli-cursor` | `5.0.0` | MIT |
| `cli-spinners` | `2.9.2` | MIT |
| `client-only` | `0.0.1` | MIT |
| `cliui` | `9.0.1` | ISC |
| `clsx` | `2.1.1` | MIT |
| `cmdk` | `1.1.1` | MIT |
| `cn` | `0.2.5` | MIT |
| `code-block-writer` | `13.0.3` | MIT |
| `comma-separated-tokens` | `2.0.3` | MIT |
| `commander` | `11.1.0` | MIT |
| `commander` | `14.0.3` | MIT |
| `common-ancestor-path` | `2.0.0` | BlueOak-1.0.0 |
| `concat-map` | `0.0.1` | MIT |
| `conf` | `10.2.0` | MIT |
| `content-disposition` | `1.1.0` | MIT |
| `content-type` | `1.0.5` | MIT |
| `content-type` | `2.1.0` | MIT |
| `convert-source-map` | `2.0.0` | MIT |
| `cookie` | `0.7.2` | MIT |
| `cookie` | `2.0.1` | MIT |
| `cookie-es` | `1.2.3` | MIT |
| `cookie-signature` | `1.2.2` | MIT |
| `cors` | `2.8.6` | MIT |
| `cosmiconfig` | `9.0.2` | MIT |
| `cross-spawn` | `7.0.6` | MIT |
| `crossws` | `0.3.5` | MIT |
| `css-select` | `6.0.0` | BSD-2-Clause |
| `css-tree` | `2.2.1` | MIT |
| `css-tree` | `3.2.1` | MIT |
| `css-what` | `7.0.0` | BSD-2-Clause |
| `cssesc` | `3.0.0` | MIT |
| `csso` | `5.0.5` | MIT |
| `csstype` | `3.2.3` | MIT |
| `damerau-levenshtein` | `1.0.8` | BSD-2-Clause |
| `data-view-buffer` | `1.0.2` | MIT |
| `data-view-byte-length` | `1.0.2` | MIT |
| `data-view-byte-offset` | `1.0.1` | MIT |
| `debounce-fn` | `4.0.0` | MIT |
| `debug` | `3.2.7` | MIT |
| `debug` | `4.4.3` | MIT |
| `decode-named-character-reference` | `1.3.0` | MIT |
| `dedent` | `1.7.2` | MIT |
| `deep-is` | `0.1.4` | MIT |
| `deepmerge` | `4.3.1` | MIT |
| `default-browser` | `5.5.1` | MIT |
| `default-browser-id` | `5.0.1` | MIT |
| `define-data-property` | `1.1.4` | MIT |
| `define-lazy-prop` | `2.0.0` | MIT |
| `define-lazy-prop` | `3.0.0` | MIT |
| `define-properties` | `1.2.1` | MIT |
| `defu` | `6.1.7` | MIT |
| `depd` | `2.0.0` | MIT |
| `dequal` | `2.0.3` | MIT |
| `destr` | `2.0.5` | MIT |
| `detect-libc` | `2.1.2` | Apache-2.0 |
| `detect-node-es` | `1.1.0` | MIT |
| `devalue` | `5.9.2` | MIT |
| `devlop` | `1.1.0` | MIT |
| `diff` | `8.0.4` | BSD-3-Clause |
| `diff` | `9.0.0` | BSD-3-Clause |
| `doctrine` | `2.1.0` | Apache-2.0 |
| `dom-serializer` | `2.0.0` | MIT |
| `domelementtype` | `2.3.0` | BSD-2-Clause |
| `domhandler` | `5.0.3` | BSD-2-Clause |
| `domutils` | `3.2.2` | BSD-2-Clause |
| `dot-prop` | `6.0.1` | MIT |
| `dotenv` | `17.4.2` | BSD-2-Clause |
| `drizzle-kit` | `0.31.10` | MIT |
| `drizzle-orm` | `0.45.2` | Apache-2.0 |
| `dset` | `3.1.4` | MIT |
| `dunder-proto` | `1.0.1` | MIT |
| `ee-first` | `1.1.1` | MIT |
| `electron-to-chromium` | `1.5.422` | ISC |
| `emmet` | `2.4.11` | MIT |
| `emoji-regex` | `10.6.0` | MIT |
| `emoji-regex` | `9.2.2` | MIT |
| `encodeurl` | `2.0.0` | MIT |
| `enhanced-resolve` | `5.24.5` | MIT |
| `enquirer` | `2.4.1` | MIT |
| `entities` | `4.5.0` | BSD-2-Clause |
| `env-paths` | `2.2.1` | MIT |
| `error-ex` | `1.3.4` | MIT |
| `es-abstract` | `1.24.2` | MIT |
| `es-abstract-get` | `1.0.0` | MIT |
| `es-define-property` | `1.0.1` | MIT |
| `es-errors` | `1.3.0` | MIT |
| `es-iterator-helpers` | `1.4.0` | MIT |
| `es-module-lexer` | `2.3.2` | MIT |
| `es-object-atoms` | `1.1.2` | MIT |
| `es-set-tostringtag` | `2.1.0` | MIT |
| `es-shim-unscopables` | `1.1.0` | MIT |
| `es-to-primitive` | `1.3.4` | MIT |
| `esbuild` | `0.18.20` | MIT |
| `esbuild` | `0.25.12` | MIT |
| `esbuild` | `0.28.2` | MIT |
| `escalade` | `3.2.0` | MIT |
| `escape-html` | `1.0.3` | MIT |
| `escape-string-regexp` | `4.0.0` | MIT |
| `escape-string-regexp` | `5.0.0` | MIT |
| `eslint` | `10.10.0` | MIT |
| `eslint-config-next` | `16.3.4` | MIT |
| `eslint-import-resolver-node` | `0.3.10` | MIT |
| `eslint-import-resolver-typescript` | `3.10.1` | ISC |
| `eslint-module-utils` | `2.14.0` | MIT |
| `eslint-plugin-import` | `2.32.0` | MIT |
| `eslint-plugin-jsx-a11y` | `6.10.2` | MIT |
| `eslint-plugin-react` | `7.37.5` | MIT |
| `eslint-plugin-react-hooks` | `7.1.1` | MIT |
| `eslint-scope` | `9.1.2` | BSD-2-Clause |
| `eslint-visitor-keys` | `3.4.3` | Apache-2.0 |
| `eslint-visitor-keys` | `5.0.1` | Apache-2.0 |
| `espree` | `11.2.0` | BSD-2-Clause |
| `esprima` | `4.0.1` | BSD-2-Clause |
| `esquery` | `1.7.0` | BSD-3-Clause |
| `esrecurse` | `4.3.0` | BSD-2-Clause |
| `estraverse` | `5.3.0` | BSD-2-Clause |
| `estree-walker` | `3.0.3` | MIT |
| `esutils` | `2.0.3` | BSD-2-Clause |
| `etag` | `1.8.1` | MIT |
| `eventemitter3` | `5.0.4` | MIT |
| `eventsource` | `3.0.7` | MIT |
| `eventsource-parser` | `3.1.1` | MIT |
| `execa` | `5.1.1` | MIT |
| `execa` | `9.6.1` | MIT |
| `expect-type` | `1.4.0` | Apache-2.0 |
| `express` | `5.2.1` | MIT |
| `express-rate-limit` | `8.7.0` | MIT |
| `extend` | `3.0.2` | MIT |
| `fast-deep-equal` | `3.1.3` | MIT |
| `fast-glob` | `3.3.1` | MIT |
| `fast-glob` | `3.3.3` | MIT |
| `fast-json-stable-stringify` | `2.1.0` | MIT |
| `fast-levenshtein` | `2.0.6` | MIT |
| `fast-string-truncated-width` | `3.0.3` | MIT |
| `fast-string-width` | `3.0.2` | MIT |
| `fast-uri` | `3.1.7` | BSD-3-Clause |
| `fast-wrap-ansi` | `0.2.2` | MIT |
| `fastq` | `1.20.3` | ISC |
| `fdir` | `6.5.0` | MIT |
| `figures` | `6.1.0` | MIT |
| `file-entry-cache` | `11.1.5` | MIT |
| `file-type` | `22.0.2` | MIT |
| `fill-range` | `7.1.1` | MIT |
| `finalhandler` | `2.1.1` | MIT |
| `find-proc` | `0.1.0` | MIT |
| `find-up` | `3.0.0` | MIT |
| `find-up` | `5.0.0` | MIT |
| `flat-cache` | `6.1.23` | MIT |
| `flatted` | `3.4.4` | ISC |
| `flattie` | `1.1.1` | MIT |
| `fontace` | `0.4.1` | MIT |
| `fontkitten` | `1.0.3` | MIT |
| `for-each` | `0.3.5` | MIT |
| `forwarded` | `0.2.0` | MIT |
| `fresh` | `2.0.0` | MIT |
| `fs-extra` | `11.4.0` | MIT |
| `function-bind` | `1.1.2` | MIT |
| `function.prototype.name` | `1.2.0` | MIT |
| `functions-have-names` | `1.2.3` | MIT |
| `fuzzysort` | `3.1.0` | MIT |
| `generator-function` | `2.0.1` | MIT |
| `gensync` | `1.0.0-beta.2` | MIT |
| `get-caller-file` | `2.0.5` | ISC |
| `get-east-asian-width` | `1.6.0` | MIT |
| `get-intrinsic` | `1.3.0` | MIT |
| `get-nonce` | `1.0.1` | MIT |
| `get-own-enumerable-keys` | `1.0.0` | MIT |
| `get-proto` | `1.0.1` | MIT |
| `get-stream` | `6.0.1` | MIT |
| `get-stream` | `9.0.1` | MIT |
| `get-symbol-description` | `1.1.0` | MIT |
| `get-tsconfig` | `4.14.3` | MIT |
| `get-tsconfig` | `5.0.0-beta.4` | MIT |
| `github-slugger` | `2.0.0` | ISC |
| `glob-parent` | `5.1.2` | ISC |
| `glob-parent` | `6.0.2` | ISC |
| `globals` | `16.4.0` | MIT |
| `globalthis` | `1.0.4` | MIT |
| `gopd` | `1.2.0` | MIT |
| `graceful-fs` | `4.2.11` | ISC |
| `h3` | `1.15.11` | MIT |
| `has-bigints` | `1.1.0` | MIT |
| `has-property-descriptors` | `1.0.2` | MIT |
| `has-proto` | `1.2.0` | MIT |
| `has-symbols` | `1.1.0` | MIT |
| `has-tostringtag` | `1.0.2` | MIT |
| `hashery` | `1.5.1` | MIT |
| `hasown` | `2.0.4` | MIT |
| `hast-util-sanitize` | `5.0.2` | MIT |
| `hast-util-to-html` | `9.0.5` | MIT |
| `hast-util-whitespace` | `3.0.0` | MIT |
| `hermes-estree` | `0.25.1` | MIT |
| `hermes-parser` | `0.25.1` | MIT |
| `hono` | `4.13.5` | MIT |
| `hookified` | `1.15.1` | MIT |
| `hookified` | `2.2.0` | MIT |
| `html-escaper` | `3.0.3` | MIT |
| `html-void-elements` | `3.0.0` | MIT |
| `http-cache-semantics` | `4.2.0` | BSD-2-Clause |
| `http-errors` | `2.0.1` | MIT |
| `human-signals` | `2.1.0` | Apache-2.0 |
| `human-signals` | `8.0.1` | Apache-2.0 |
| `iconv-lite` | `0.7.3` | MIT |
| `icu-minify` | `4.14.2` | MIT |
| `ieee754` | `1.2.1` | BSD-3-Clause |
| `ignore` | `5.3.2` | MIT |
| `ignore` | `7.0.8` | MIT |
| `import-fresh` | `3.3.1` | MIT |
| `imurmurhash` | `0.1.4` | MIT |
| `inherits` | `2.0.4` | ISC |
| `internal-slot` | `1.1.0` | MIT |
| `intl-messageformat` | `11.2.14` | BSD-3-Clause |
| `ip-address` | `10.7.0` | MIT |
| `ipaddr.js` | `1.9.1` | MIT |
| `iron-webcrypto` | `1.2.1` | MIT |
| `is-alphabetical` | `2.0.1` | MIT |
| `is-alphanumerical` | `2.0.1` | MIT |
| `is-array-buffer` | `3.0.5` | MIT |
| `is-arrayish` | `0.2.1` | MIT |
| `is-async-function` | `2.1.1` | MIT |
| `is-bigint` | `1.1.0` | MIT |
| `is-boolean-object` | `1.2.2` | MIT |
| `is-bun-module` | `2.0.0` | MIT |
| `is-callable` | `1.2.7` | MIT |
| `is-core-module` | `2.16.2` | MIT |
| `is-data-view` | `1.0.2` | MIT |
| `is-date-object` | `1.1.0` | MIT |
| `is-decimal` | `2.0.1` | MIT |
| `is-docker` | `2.2.1` | MIT |
| `is-docker` | `3.0.0` | MIT |
| `is-docker` | `4.0.0` | MIT |
| `is-document.all` | `1.0.0` | MIT |
| `is-extglob` | `2.1.1` | MIT |
| `is-finalizationregistry` | `1.1.1` | MIT |
| `is-generator-function` | `1.1.2` | MIT |
| `is-glob` | `4.0.3` | MIT |
| `is-hexadecimal` | `2.0.1` | MIT |
| `is-in-ssh` | `1.0.0` | MIT |
| `is-inside-container` | `1.0.0` | MIT |
| `is-interactive` | `2.0.0` | MIT |
| `is-map` | `2.0.3` | MIT |
| `is-negative-zero` | `2.0.3` | MIT |
| `is-number` | `7.0.0` | MIT |
| `is-number-object` | `1.1.1` | MIT |
| `is-obj` | `2.0.0` | MIT |
| `is-obj` | `3.0.0` | MIT |
| `is-plain-obj` | `4.1.0` | MIT |
| `is-promise` | `4.0.0` | MIT |
| `is-regex` | `1.2.1` | MIT |
| `is-regexp` | `3.1.0` | MIT |
| `is-set` | `2.0.3` | MIT |
| `is-shared-array-buffer` | `1.0.4` | MIT |
| `is-stream` | `2.0.1` | MIT |
| `is-stream` | `4.0.1` | MIT |
| `is-string` | `1.1.1` | MIT |
| `is-symbol` | `1.1.1` | MIT |
| `is-typed-array` | `1.1.15` | MIT |
| `is-unicode-supported` | `1.3.0` | MIT |
| `is-unicode-supported` | `2.1.0` | MIT |
| `is-weakmap` | `2.0.2` | MIT |
| `is-weakref` | `1.1.1` | MIT |
| `is-weakset` | `2.0.4` | MIT |
| `is-wsl` | `2.2.0` | MIT |
| `is-wsl` | `3.1.1` | MIT |
| `isarray` | `2.0.5` | MIT |
| `isexe` | `2.0.0` | ISC |
| `isexe` | `3.1.5` | BlueOak-1.0.0 |
| `iterator.prototype` | `1.1.5` | MIT |
| `jiti` | `2.7.0` | MIT |
| `jose` | `6.2.11` | MIT |
| `js-tokens` | `4.0.0` | MIT |
| `js-yaml` | `4.3.2` | MIT |
| `jsesc` | `3.1.0` | MIT |
| `json-parse-even-better-errors` | `2.3.1` | MIT |
| `json-schema-traverse` | `0.4.1` | MIT |
| `json-schema-traverse` | `1.0.0` | MIT |
| `json-schema-typed` | `7.0.3` | BSD-2-Clause |
| `json-schema-typed` | `8.0.2` | BSD-2-Clause |
| `json-stable-stringify-without-jsonify` | `1.0.1` | MIT |
| `json5` | `1.0.2` | MIT |
| `json5` | `2.2.3` | MIT |
| `jsonc-parser` | `2.3.1` | MIT |
| `jsonc-parser` | `3.3.1` | MIT |
| `jsonfile` | `6.2.1` | MIT |
| `jsx-ast-utils` | `3.3.5` | MIT |
| `keyv` | `5.6.0` | MIT |
| `kleur` | `3.0.3` | MIT |
| `kleur` | `4.1.5` | MIT |
| `language-subtag-registry` | `0.3.23` | CC0-1.0 |
| `language-tags` | `1.0.9` | MIT |
| `levn` | `0.4.1` | MIT |
| `lightningcss` | `1.32.0` | MPL-2.0 |
| `lightningcss` | `1.33.0` | MPL-2.0 |
| `lightningcss-linux-arm64-gnu` | `1.32.0` | MPL-2.0 |
| `lightningcss-linux-arm64-gnu` | `1.33.0` | MPL-2.0 |
| `lines-and-columns` | `1.2.4` | MIT |
| `locate-path` | `3.0.0` | MIT |
| `locate-path` | `6.0.0` | MIT |
| `log-symbols` | `6.0.0` | MIT |
| `longest-streak` | `3.1.0` | MIT |
| `loose-envify` | `1.4.0` | MIT |
| `lru-cache` | `11.5.2` | BlueOak-1.0.0 |
| `lru-cache` | `5.1.1` | ISC |
| `lucide-react` | `1.41.0` | ISC |
| `magic-string` | `0.30.21` | MIT |
| `magic-string` | `1.2.3` | MIT |
| `magicast` | `0.5.4` | MIT |
| `markdown-table` | `3.0.4` | MIT |
| `math-intrinsics` | `1.1.0` | MIT |
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
| `media-typer` | `1.1.1` | MIT |
| `merge-descriptors` | `2.0.0` | MIT |
| `merge-stream` | `2.0.0` | MIT |
| `merge2` | `1.4.1` | MIT |
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
| `micromatch` | `4.0.8` | MIT |
| `mime-db` | `1.54.0` | MIT |
| `mime-types` | `3.0.2` | MIT |
| `mimic-fn` | `2.1.0` | MIT |
| `mimic-fn` | `3.1.0` | MIT |
| `mimic-function` | `5.0.1` | MIT |
| `minimatch` | `10.2.6` | BlueOak-1.0.0 |
| `minimatch` | `3.1.5` | ISC |
| `minimist` | `1.2.8` | MIT |
| `minipass` | `7.1.3` | BlueOak-1.0.0 |
| `minizlib` | `3.1.0` | MIT |
| `mrmime` | `2.0.1` | MIT |
| `ms` | `2.1.3` | MIT |
| `muggle-string` | `0.4.1` | MIT |
| `nanoid` | `3.3.18` | MIT |
| `napi-postinstall` | `0.3.4` | MIT |
| `natural-compare` | `1.4.0` | MIT |
| `negotiator` | `1.1.0` | MIT |
| `neotraverse` | `1.0.1` | MIT |
| `next` | `16.3.4` | MIT |
| `next-intl` | `4.14.2` | MIT |
| `next-intl-swc-plugin-extractor` | `4.14.2` | MIT |
| `next-themes` | `0.4.6` | MIT |
| `nlcst-to-string` | `4.0.0` | MIT |
| `node-addon-api` | `7.1.1` | MIT |
| `node-addon-api` | `8.9.2` | MIT |
| `node-exports-info` | `1.6.2` | MIT |
| `node-fetch-native` | `1.6.7` | MIT |
| `node-mock-http` | `1.0.5` | MIT |
| `node-releases` | `2.0.54` | MIT |
| `normalize-path` | `3.0.0` | MIT |
| `npm-run-path` | `4.0.1` | MIT |
| `npm-run-path` | `6.0.0` | MIT |
| `nth-check` | `2.1.1` | BSD-2-Clause |
| `object-assign` | `4.1.1` | MIT |
| `object-inspect` | `1.13.4` | MIT |
| `object-keys` | `1.1.1` | MIT |
| `object-treeify` | `1.1.33` | MIT |
| `object.assign` | `4.1.7` | MIT |
| `object.entries` | `1.1.9` | MIT |
| `object.fromentries` | `2.0.8` | MIT |
| `object.groupby` | `1.0.3` | MIT |
| `object.values` | `1.2.1` | MIT |
| `obug` | `2.1.4` | MIT |
| `ofetch` | `1.5.1` | MIT |
| `ohash` | `2.0.12` | MIT |
| `on-finished` | `2.4.1` | MIT |
| `once` | `1.4.0` | ISC |
| `onetime` | `5.1.2` | MIT |
| `onetime` | `7.0.0` | MIT |
| `oniguruma-parser` | `0.12.2` | MIT |
| `oniguruma-to-es` | `4.3.6` | MIT |
| `open` | `11.0.2` | MIT |
| `open` | `8.4.2` | MIT |
| `optionator` | `0.9.4` | MIT |
| `ora` | `8.2.0` | MIT |
| `own-keys` | `1.0.2` | MIT |
| `p-limit` | `2.3.0` | MIT |
| `p-limit` | `3.1.0` | MIT |
| `p-limit` | `7.3.2` | MIT |
| `p-locate` | `3.0.0` | MIT |
| `p-locate` | `5.0.0` | MIT |
| `p-queue` | `9.3.3` | MIT |
| `p-timeout` | `7.0.1` | MIT |
| `p-try` | `2.2.0` | MIT |
| `package-manager-detector` | `1.8.0` | MIT |
| `parent-module` | `1.0.1` | MIT |
| `parse-entities` | `4.0.2` | MIT |
| `parse-json` | `5.2.0` | MIT |
| `parse-ms` | `4.0.0` | MIT |
| `parseurl` | `1.3.3` | MIT |
| `path-browserify` | `1.0.1` | MIT |
| `path-exists` | `3.0.0` | MIT |
| `path-exists` | `4.0.0` | MIT |
| `path-key` | `3.1.1` | MIT |
| `path-key` | `4.0.0` | MIT |
| `path-parse` | `1.0.7` | MIT |
| `path-to-regexp` | `8.4.2` | MIT |
| `piccolore` | `0.1.3` | ISC |
| `picocolors` | `1.1.1` | ISC |
| `picomatch` | `2.3.2` | MIT |
| `picomatch` | `4.0.7` | MIT |
| `pkce-challenge` | `5.0.1` | MIT |
| `pkg-up` | `3.1.0` | MIT |
| `playwright` | `1.63.0` | Apache-2.0 |
| `playwright-core` | `1.63.0` | Apache-2.0 |
| `po-parser` | `2.2.0` | MIT |
| `possible-typed-array-names` | `1.1.0` | MIT |
| `postcss` | `8.5.23` | MIT |
| `postcss` | `8.5.28` | MIT |
| `postcss-selector-parser` | `7.1.6` | MIT |
| `powershell-utils` | `0.1.0` | MIT |
| `powershell-utils` | `0.2.1` | MIT |
| `prelude-ls` | `1.2.1` | MIT |
| `prettier` | `3.9.6` | MIT |
| `pretty-ms` | `9.3.1` | MIT |
| `prismjs` | `1.30.0` | MIT |
| `process-ancestry` | `0.1.0` | MIT |
| `prompts` | `2.4.2` | MIT |
| `prop-types` | `15.8.1` | MIT |
| `property-information` | `7.2.0` | MIT |
| `proxy-addr` | `2.0.7` | MIT |
| `punycode` | `2.3.1` | MIT |
| `qified` | `0.10.1` | MIT |
| `qs` | `6.16.0` | BSD-3-Clause |
| `queue-microtask` | `1.2.3` | MIT |
| `radix3` | `1.1.2` | MIT |
| `range-parser` | `1.3.0` | MIT |
| `raw-body` | `3.0.2` | MIT |
| `react` | `19.2.8` | MIT |
| `react-dom` | `19.2.8` | MIT |
| `react-is` | `16.13.1` | MIT |
| `react-remove-scroll` | `2.7.2` | MIT |
| `react-remove-scroll-bar` | `2.3.8` | MIT |
| `react-style-singleton` | `2.2.3` | MIT |
| `readdirp` | `4.1.2` | MIT |
| `readdirp` | `5.1.1` | MIT |
| `recast` | `0.23.21` | MIT |
| `reflect.getprototypeof` | `1.0.10` | MIT |
| `regex` | `6.1.0` | MIT |
| `regex-recursion` | `6.0.2` | MIT |
| `regex-utilities` | `2.3.0` | MIT |
| `regexp.prototype.flags` | `1.5.4` | MIT |
| `rehype-sanitize` | `6.0.0` | MIT |
| `rehype-stringify` | `10.0.1` | MIT |
| `remark-directive` | `4.0.0` | MIT |
| `remark-gfm` | `4.0.1` | MIT |
| `remark-parse` | `11.0.0` | MIT |
| `remark-rehype` | `11.1.2` | MIT |
| `remark-stringify` | `11.0.0` | MIT |
| `request-light` | `0.5.8` | MIT |
| `request-light` | `0.7.0` | MIT |
| `require-from-string` | `2.0.2` | MIT |
| `reselect` | `5.3.0` | MIT |
| `resolve` | `2.0.0-next.7` | MIT |
| `resolve-from` | `4.0.0` | MIT |
| `resolve-pkg-maps` | `1.0.0` | MIT |
| `restore-cursor` | `5.1.0` | MIT |
| `retext-smartypants` | `6.2.0` | MIT |
| `reusify` | `1.1.0` | MIT |
| `rolldown` | `1.2.7` | MIT |
| `router` | `2.2.0` | MIT |
| `run-applescript` | `7.1.0` | MIT |
| `run-parallel` | `1.2.0` | MIT |
| `safe-array-concat` | `1.1.4` | MIT |
| `safe-push-apply` | `1.0.0` | MIT |
| `safe-regex-test` | `1.1.0` | MIT |
| `safer-buffer` | `2.1.2` | MIT |
| `satteri` | `0.10.5` | MIT |
| `sax` | `1.6.1` | BlueOak-1.0.0 |
| `scheduler` | `0.27.0` | MIT |
| `semver` | `6.3.1` | ISC |
| `semver` | `7.8.5` | ISC |
| `send` | `1.2.1` | MIT |
| `serve-static` | `2.2.1` | MIT |
| `server-only` | `0.0.1` | MIT |
| `set-function-length` | `1.2.2` | MIT |
| `set-function-name` | `2.0.2` | MIT |
| `set-proto` | `1.0.0` | MIT |
| `setprototypeof` | `1.2.0` | ISC |
| `shadcn` | `4.21.0` | MIT |
| `sharp` | `0.35.4` | Apache-2.0 |
| `shebang-command` | `2.0.0` | MIT |
| `shebang-regex` | `3.0.0` | MIT |
| `shiki` | `4.4.3` | MIT |
| `side-channel` | `1.1.1` | MIT |
| `side-channel-list` | `1.0.1` | MIT |
| `side-channel-map` | `1.0.1` | MIT |
| `side-channel-weakmap` | `1.0.2` | MIT |
| `siginfo` | `2.0.0` | ISC |
| `signal-exit` | `3.0.7` | ISC |
| `signal-exit` | `4.1.0` | ISC |
| `sisteransi` | `1.0.5` | MIT |
| `sitemap` | `9.0.1` | MIT |
| `smart-buffer` | `4.2.0` | MIT |
| `smol-toml` | `1.8.0` | BSD-3-Clause |
| `socks` | `2.8.10` | MIT |
| `sonner` | `2.0.8` | MIT |
| `source-map` | `0.6.1` | BSD-3-Clause |
| `source-map-js` | `1.2.1` | BSD-3-Clause |
| `source-map-support` | `0.5.21` | MIT |
| `space-separated-tokens` | `2.0.2` | MIT |
| `stable-hash` | `0.0.5` | MIT |
| `stackback` | `0.0.2` | MIT |
| `statuses` | `2.0.2` | MIT |
| `std-env` | `4.2.0` | MIT |
| `stdin-discarder` | `0.2.2` | MIT |
| `stop-iteration-iterator` | `1.1.0` | MIT |
| `string-width` | `7.2.0` | MIT |
| `string-width` | `8.2.2` | MIT |
| `string.prototype.includes` | `2.0.1` | MIT |
| `string.prototype.matchall` | `4.1.0` | MIT |
| `string.prototype.repeat` | `1.0.0` | MIT |
| `string.prototype.trim` | `1.2.11` | MIT |
| `string.prototype.trimend` | `1.0.10` | MIT |
| `string.prototype.trimstart` | `1.0.8` | MIT |
| `stringify-entities` | `4.0.4` | MIT |
| `stringify-object` | `5.0.0` | BSD-2-Clause |
| `strip-ansi` | `6.0.1` | MIT |
| `strip-ansi` | `7.2.0` | MIT |
| `strip-bom` | `3.0.0` | MIT |
| `strip-final-newline` | `2.0.0` | MIT |
| `strip-final-newline` | `4.0.0` | MIT |
| `strtok3` | `10.3.5` | MIT |
| `styled-jsx` | `5.1.6` | MIT |
| `supports-preserve-symlinks-flag` | `1.0.0` | MIT |
| `svgo` | `4.1.0` | MIT |
| `systeminformation` | `5.33.8` | MIT |
| `tailwind-merge` | `3.6.0` | MIT |
| `tailwindcss` | `4.3.3` | MIT |
| `tapable` | `2.3.3` | MIT |
| `tar` | `7.5.22` | BlueOak-1.0.0 |
| `tiny-inflate` | `1.0.3` | MIT |
| `tiny-invariant` | `1.3.3` | MIT |
| `tinybench` | `6.1.4` | MIT |
| `tinyclip` | `0.1.15` | MIT |
| `tinyexec` | `1.3.0` | MIT |
| `tinyglobby` | `0.2.17` | MIT |
| `to-regex-range` | `5.0.1` | MIT |
| `toidentifier` | `1.0.1` | MIT |
| `token-types` | `6.1.2` | MIT |
| `trim-lines` | `3.0.1` | MIT |
| `trough` | `2.2.0` | MIT |
| `ts-api-utils` | `2.5.0` | MIT |
| `ts-morph` | `26.0.0` | MIT |
| `tsconfig-paths` | `3.15.0` | MIT |
| `tsconfig-paths` | `4.2.0` | MIT |
| `tslib` | `2.8.1` | 0BSD |
| `tsx` | `4.23.13` | MIT |
| `tw-animate-css` | `1.4.0` | MIT |
| `type-check` | `0.4.0` | MIT |
| `type-is` | `2.1.0` | MIT |
| `typed-array-buffer` | `1.0.3` | MIT |
| `typed-array-byte-length` | `1.0.3` | MIT |
| `typed-array-byte-offset` | `1.0.4` | MIT |
| `typed-array-length` | `1.0.8` | MIT |
| `typesafe-path` | `0.2.2` | MIT |
| `typescript` | `6.0.3` | Apache-2.0 |
| `typescript-auto-import-cache` | `0.3.6` | MIT |
| `typescript-eslint` | `8.69.0` | MIT |
| `ufo` | `1.6.4` | MIT |
| `uint8array-extras` | `1.5.0` | MIT |
| `ulid` | `3.0.2` | MIT |
| `ultrahtml` | `1.7.0` | MIT |
| `unbox-primitive` | `1.1.0` | MIT |
| `uncrypto` | `0.1.3` | MIT |
| `undici` | `7.29.1` | MIT |
| `undici` | `8.10.2` | MIT |
| `undici-types` | `7.18.2` | MIT |
| `undici-types` | `8.3.0` | MIT |
| `unicorn-magic` | `0.3.0` | MIT |
| `unified` | `11.0.5` | MIT |
| `unifont` | `0.7.5` | MIT |
| `unist-util-is` | `6.0.1` | MIT |
| `unist-util-position` | `5.0.0` | MIT |
| `unist-util-stringify-position` | `4.0.0` | MIT |
| `unist-util-visit` | `5.1.0` | MIT |
| `unist-util-visit-parents` | `6.0.2` | MIT |
| `universalify` | `2.0.1` | MIT |
| `unpipe` | `1.0.0` | MIT |
| `unrs-resolver` | `1.12.2` | MIT |
| `unstorage` | `1.17.5` | MIT |
| `update-browserslist-db` | `1.3.2` | MIT |
| `uri-js` | `4.4.1` | BSD-2-Clause |
| `use-callback-ref` | `1.3.3` | MIT |
| `use-intl` | `4.14.2` | MIT |
| `use-sidecar` | `1.1.3` | MIT |
| `use-sync-external-store` | `1.6.0` | MIT |
| `util-deprecate` | `1.0.2` | MIT |
| `validate-npm-package-name` | `7.0.2` | ISC |
| `vary` | `1.1.2` | MIT |
| `verein-basis` | `0.1.0` | unbekannt |
| `vfile` | `6.0.3` | MIT |
| `vfile-message` | `4.0.3` | MIT |
| `vite` | `8.2.2` | MIT |
| `vitefu` | `1.1.3` | MIT |
| `vitest` | `5.0.0` | MIT |
| `volar-service-css` | `0.0.71` | MIT |
| `volar-service-emmet` | `0.0.71` | MIT |
| `volar-service-html` | `0.0.71` | MIT |
| `volar-service-prettier` | `0.0.71` | MIT |
| `volar-service-typescript` | `0.0.71` | MIT |
| `volar-service-typescript-twoslash-queries` | `0.0.71` | MIT |
| `volar-service-yaml` | `0.0.71` | MIT |
| `vscode-css-languageservice` | `6.3.10` | MIT |
| `vscode-html-languageservice` | `5.6.2` | MIT |
| `vscode-json-languageservice` | `4.1.8` | MIT |
| `vscode-jsonrpc` | `8.2.0` | MIT |
| `vscode-jsonrpc` | `9.0.2` | MIT |
| `vscode-languageserver` | `9.0.1` | MIT |
| `vscode-languageserver-protocol` | `3.17.5` | MIT |
| `vscode-languageserver-protocol` | `3.18.3` | MIT |
| `vscode-languageserver-textdocument` | `1.0.14` | MIT |
| `vscode-languageserver-types` | `3.17.5` | MIT |
| `vscode-languageserver-types` | `3.18.3` | MIT |
| `vscode-nls` | `5.2.0` | MIT |
| `vscode-uri` | `3.2.0` | MIT |
| `which` | `2.0.2` | ISC |
| `which` | `4.0.0` | ISC |
| `which-boxed-primitive` | `1.1.1` | MIT |
| `which-builtin-type` | `1.2.1` | MIT |
| `which-collection` | `1.0.2` | MIT |
| `which-typed-array` | `1.1.22` | MIT |
| `why-is-node-running` | `2.3.0` | MIT |
| `word-wrap` | `1.2.5` | MIT |
| `wrap-ansi` | `9.0.2` | MIT |
| `wrappy` | `1.0.2` | ISC |
| `wsl-utils` | `1.0.0` | MIT |
| `xxhash-wasm` | `1.1.0` | MIT |
| `y18n` | `5.0.8` | ISC |
| `yallist` | `3.1.1` | ISC |
| `yallist` | `5.0.0` | BlueOak-1.0.0 |
| `yaml` | `2.8.3` | ISC |
| `yaml` | `2.9.0` | ISC |
| `yaml-language-server` | `1.23.0` | MIT |
| `yargs` | `18.1.0` | MIT |
| `yargs-parser` | `22.0.0` | ISC |
| `yocto-queue` | `0.1.0` | MIT |
| `yocto-queue` | `1.2.2` | MIT |
| `yocto-spinner` | `1.2.2` | MIT |
| `yoctocolors` | `2.2.0` | MIT |
| `zod` | `3.25.76` | MIT |
| `zod` | `4.5.4` | MIT |
| `zod-to-json-schema` | `3.25.2` | ISC |
| `zod-validation-error` | `4.0.2` | MIT |
| `zwitch` | `2.0.4` | MIT |
