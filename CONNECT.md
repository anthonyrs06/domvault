# Join the network

This is how a new person publishes a few notes into the shared Constellation universe and sees
their **star** appear next to everyone else's. It takes about five minutes.

> ### Three things that are always true
> 1. **Publishing is OPT-IN, per note.** Nothing is published unless *you* set `publish: true` on
>    that specific note and confirm the diff. The default is `publish: false`.
> 2. **Your vault never leaves your machine.** Only the individual notes you choose to publish are
>    sent — run through a fail-closed stripper first. Your private keys are never transmitted.
> 3. **Unpublish removes a planet.** `DELETE` (or the unpublish command) tombstones it — it
>    disappears from the universe.

---

## 1. Clone + install the engine

```bash
git clone https://github.com/dys5315/domvault && cd domvault
./plugin/install.sh ~/my-brain        # scaffolds your local brain (your notes live here, privately)
npm install                            # dev toolchain for the publish client
```

## 2. Make your keypair (stays on your machine)

```bash
mkdir -p ~/.constellation
node -e "import('./registry/server/keys.ts').then(async m=>{ \
  const {publicKey,privateKey}=m.generateKeypair(); const fs=await import('node:fs'); \
  fs.writeFileSync(process.env.HOME+'/.constellation/id_ed25519.pem',privateKey,{mode:0o600}); \
  fs.writeFileSync(process.env.HOME+'/.constellation/id_ed25519.pub.pem',publicKey); \
  console.log('keypair written to ~/.constellation'); })" 2>/dev/null || \
  npx tsx -e "import {generateKeypair} from './registry/server/keys.ts'; import {writeFileSync} from 'node:fs'; \
    const k=generateKeypair(); const d=process.env.HOME+'/.constellation'; \
    writeFileSync(d+'/id_ed25519.pem',k.privateKey,{mode:0o600}); writeFileSync(d+'/id_ed25519.pub.pem',k.publicKey); \
    console.log('keypair written to ~/.constellation');"
```

The **private** key never leaves `~/.constellation` (outside the repo) and is never committed or
sent. Your **public** key is your star identity.

## 3. Point at the hosted registry

```bash
export CONSTELLATION_REGISTRY="https://domvault-registry.fly.dev"   # e.g. https://domvault-registry.fly.dev
export CONSTELLATION_HANDLE="yourname"
export CONSTELLATION_STAR="star_yourname"
export CONSTELLATION_PRIVKEY=~/.constellation/id_ed25519.pem
export CONSTELLATION_PUBKEY=~/.constellation/id_ed25519.pub.pem
# Private beta only — the operator gives you this; omit once the gate is opened:
export CONSTELLATION_TOKEN="<publish-token-from-the-operator>"
```

## 4. Choose what to publish — opt in per note

In any note you want to share, set the frontmatter flag (and make sure it's genericized — no
private/client details):

```yaml
---
title: My Mental Model
publish: true
tags: [framework, ...]
---
```

Everything without `publish: true` stays private and is never sent.

## 5. Publish (you review the diff first)

```bash
npx tsx client/cli.ts publish ~/my-brain/30-frameworks/my-model.md
```

You'll see **exactly what will be published vs. withheld** before anything leaves your machine.
Confirm, and the note becomes a content-addressed, signed **planet**. The registry verifies your
signature and stores it; the `planet_id` is written back into your note.

## 6. See your star join the universe

Open the Explorer (the operator can host it, or run it locally):

```bash
npm run demo          # local: serves the Explorer at http://localhost:8080
# or open constellation/index.html?registry=https://domvault-registry.fly.dev
```

Your solar system now sits in the universe next to everyone else's. Click any planet to read its
manifest (title, author, license, lineage, version).

## Unpublish anytime

```bash
# remove a planet you published (tombstone — it leaves the universe)
curl -X DELETE "$CONSTELLATION_REGISTRY/planets/<planet_id>" \
  -H "Authorization: Bearer $CONSTELLATION_TOKEN"
```

## Public map (git-backed, after auto-publish lands)

The hosted Explorer at https://dys5315.github.io/domvault/constellation/ reads the
**static Vercel registry** (`https://domvault-registry.vercel.app`), not Fly.
Fly (`https://domvault-registry.fly.dev`) is the live signed-POST registry and
the long-term write path; it is also the flaky one. Until Fly reliably feeds the
public map, new planets reach github.io through the `constellation-publish`
Action on `main` (rebuild `universe.json`, commit, Vercel deploys).

After that Action is on `main`, scan your vault and/or dispatch a note instead of
opening another PR:

    npx tsx scripts/publish-from-vault.ts /home/box/my-brain

Add the dispatch flag to fire `repository_dispatch` (needs write on
`dys5315/domvault`). Details: [`docs/11-auto-publish.md`](docs/11-auto-publish.md).

---

See [`TERMS.md`](TERMS.md) for what the registry stores and the operator's responsibilities.
The engine itself is yours to self-host — see [`SERVICES.md`](SERVICES.md).
