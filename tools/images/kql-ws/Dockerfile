# KQL workstation ("learner@kql-ws") for the security-operations labs, catalog ref kql-ws:1.
# Built by tools/images/build-kql-ws.sh (and CI, .github/workflows/images.yml); every
# version comes from deploy/versions.env.
#
# Engine: KustoLoco (github.com/NeilMacMullen/kusto-loco, MIT) at KUSTOLOCO_COMMIT with the
# CloudTrain patches in patches/ applied in order (git am). Its query parser, Kusto.Language,
# is compiled from github.com/microsoft/Kusto-Query-Language (Apache-2.0) at
# KUSTO_LANGUAGE_COMMIT instead of the NuGet package, which ships under the Azure Data
# Explorer SDK EULA; the Azure connectors (.adx, .loganalytics, .appinsights, .arg) and
# with them the Kusto.Data / Kusto.Cloud.Platform packages are left out (patch
# "build: licence-clean profile"). See docs/handoffs/soc.md "Licences".
#
# Contents: lokql (self-contained .NET 10, in /opt/cloudtrain/kql/lokql), `kql` (the shell
# learners use: lokql with the lab's tables loaded), `ct-kql` (lab checks: queries run as
# the learner, JSON/CSV/scalar/count/compare output), `kql-load`, `ct-loggen` (seeded
# Sentinel-shaped synthetic logs), the datasets in /opt/cloudtrain/kql/datasets (demo:
# ct-loggen output; sentinel-sample: Azure-Sentinel "Sample Data", MIT), python3, jq, vim,
# nano, less. Lab data goes to /srv/kql/lab (setup, as root), the generator's answers to
# /var/lib/cloudtrain/kql (root only). Licence notices: /usr/share/doc/cloudtrain-kql.

# --- build: KustoLoco + patches, Kusto.Language from source ------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0-noble@sha256:0d99ebf1ccad15037b5c98c9fe8979d6b8dbac23812feae2277a0b277b5c5ffa AS build
ARG KUSTOLOCO_COMMIT
ARG KUSTO_LANGUAGE_COMMIT
# 1 runs KustoLoco's BasicTests and LokqlEngineTests on the patched tree (a few minutes)
ARG RUN_TESTS=1
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# hadolint ignore=DL3008
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN test -n "$KUSTOLOCO_COMMIT" && test -n "$KUSTO_LANGUAGE_COMMIT" \
 && git init -q kusto-loco && git -C kusto-loco fetch -q --depth 1 https://github.com/NeilMacMullen/kusto-loco.git "$KUSTOLOCO_COMMIT" \
 && git -C kusto-loco checkout -q FETCH_HEAD && test "$(git -C kusto-loco rev-parse HEAD)" = "$KUSTOLOCO_COMMIT" \
 && git init -q kusto-language && git -C kusto-language fetch -q --depth 1 https://github.com/microsoft/Kusto-Query-Language.git "$KUSTO_LANGUAGE_COMMIT" \
 && git -C kusto-language checkout -q FETCH_HEAD && test "$(git -C kusto-language rev-parse HEAD)" = "$KUSTO_LANGUAGE_COMMIT"
# Kusto.Language's syntax nodes and command grammars are generated sources (T4 templates
# in the repo since 2026-07-08); kusto-language-codegen calls the same generators.
COPY kusto-language-codegen/ /src/kusto-language-codegen/
RUN dotnet run --project /src/kusto-language-codegen -c Release -p:KustoLanguageSrc=/src/kusto-language/src \
      -- /src/kusto-language/src/Kusto.Language
COPY patches/ /src/patches/
RUN cd kusto-loco && git -c user.name=cloudtrain-build -c user.email=build@cloudtrain.invalid am -q /src/patches/*.patch
# KustoLanguageProject / LokqlAzureConnectors: see the licence-clean profile patch
ENV KQL_BUILD_PROPS="-p:KustoLanguageProject=/src/kusto-language/src/Kusto.Language/Kusto.Language.csproj -p:LokqlAzureConnectors=false"
# hadolint ignore=SC2086
RUN cd kusto-loco && if [[ $RUN_TESTS == 1 ]]; then \
      dotnet test test/BasicTests -c Release $KQL_BUILD_PROPS --logger "console;verbosity=minimal" \
   && dotnet test test/LokqlEngineTests -c Release $KQL_BUILD_PROPS --logger "console;verbosity=minimal"; fi
# hadolint ignore=SC2086
RUN cd kusto-loco && dotnet publish applications/lokql/lokql.csproj -c Release -r linux-x64 --self-contained \
      -p:PublishSingleFile=false -p:PublishReadyToRun=true -p:InvariantGlobalization=true $KQL_BUILD_PROPS -o /out/lokql \
 && ! ls /out/lokql | grep -qiE '^Kusto\.(Data|Cloud)' \
 && rm -f /out/lokql/*.pdb
# Licence notices of everything published: KustoLoco, Kusto.Language, every NuGet package
# in lokql's dependency graph (licence files from the package, or its declared licence).
COPY licences/ /src/licences/
RUN mkdir -p /out/doc \
 && cp kusto-loco/LICENSE /out/doc/kusto-loco-LICENSE \
 && cp kusto-language/LICENSE /out/doc/kusto-language-LICENSE \
 && find kusto-loco/libraries -name NOTICE -not -path '*/obj/*' -not -path '*/bin/*' \
      | while read -r f; do n=$(basename "$(dirname "$f")" | tr "A-Z." "a-z-"); cp "$f" "/out/doc/$n-NOTICE"; done \
 && git -C kusto-loco log --format='%h %s' "$KUSTOLOCO_COMMIT"..HEAD > /out/doc/kusto-loco-patches.txt \
 && python3 /src/licences/collect-nuget-licences.py kusto-loco/applications/lokql/obj/project.assets.json \
      /root/.nuget/packages /out/doc/nuget /src/licences/overrides

# --- data: the Sentinel sample dataset and the demo dataset ----------------------------------
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55 AS data
ARG UBUNTU_APT_SNAPSHOT
ARG AZURE_SENTINEL_COMMIT
ARG AZURE_SENTINEL_LICENSE_SHA256
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# hadolint ignore=DL3008
RUN test -n "$UBUNTU_APT_SNAPSHOT" \
 && apt-get -o Acquire::ForceIPv4=true update && apt-get install -y --no-install-recommends ca-certificates \
 && apt-get -o Acquire::ForceIPv4=true -o APT::Update::Error-Mode=any update --snapshot "$UBUNTU_APT_SNAPSHOT" \
 && apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends --snapshot "$UBUNTU_APT_SNAPSHOT" python3 curl \
 && rm -rf /var/lib/apt/lists/*
COPY sample-data/ /build/sample-data/
COPY loggen/ /opt/cloudtrain/loggen/
RUN set -eu; base="https://raw.githubusercontent.com/Azure/Azure-Sentinel/${AZURE_SENTINEL_COMMIT}"; \
    mkdir -p /build/src /out/doc; \
    curl -fsSL -o /out/doc/azure-sentinel-LICENSE "$base/LICENSE"; \
    echo "${AZURE_SENTINEL_LICENSE_SHA256}  /out/doc/azure-sentinel-LICENSE" | sha256sum -c - >/dev/null; \
    grep -v '^#' /build/sample-data/sources.lock | grep . | while read -r _ _ _ path; do \
      mkdir -p "/build/src/$(dirname "$path")"; \
      curl -fsSL -o "/build/src/$path" "$base/Sample%20Data/${path// /%20}"; \
    done; \
    python3 -I /build/sample-data/import.py /build/src /out/datasets/sentinel-sample /build/sample-data/sources.lock
# the generator's own tests, then a fixed demo dataset (seed "demo") for `kql` outside a lab
RUN cd /opt/cloudtrain/loggen && python3 -I -m unittest discover -s tests -t . -q \
 && python3 -I /opt/cloudtrain/loggen/ct-loggen generate --seed demo --end 2026-10-18T12:00:00Z \
      --out /out/datasets/demo --answers /out/demo-answers.json \
 && rm -rf /opt/cloudtrain/loggen/tests && find /opt/cloudtrain/loggen -name __pycache__ -prune -exec rm -rf {} +

# --- runtime ---------------------------------------------------------------------------------
FROM ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
ARG UBUNTU_APT_SNAPSHOT
ARG KUSTOLOCO_VERSION
ARG KUSTOLOCO_COMMIT
ARG KUSTO_LANGUAGE_COMMIT
ARG AZURE_SENTINEL_COMMIT
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1 DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_TieredPGO=0
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
# .NET runtime dependencies (libc6, libgcc-s1, libstdc++6, libssl3, zlib1g are in the base or
# pulled in), fontconfig + DejaVu for chart rendering, and the shell tools.
# hadolint ignore=DL3008
RUN test -n "$UBUNTU_APT_SNAPSHOT" \
 && apt-get -o Acquire::ForceIPv4=true update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && apt-get -o Acquire::ForceIPv4=true -o APT::Update::Error-Mode=any update --snapshot "$UBUNTU_APT_SNAPSHOT" \
 && apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends --snapshot "$UBUNTU_APT_SNAPSHOT" \
      libstdc++6 libssl3t64 zlib1g libfontconfig1 fonts-dejavu-core python3 jq less vim nano \
      bash-completion curl file tree \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/lokql /opt/cloudtrain/kql/lokql
COPY --from=build /out/doc /usr/share/doc/cloudtrain-kql
COPY --from=data /out/doc/azure-sentinel-LICENSE /usr/share/doc/cloudtrain-kql/azure-sentinel-LICENSE
COPY --from=data /out/datasets /opt/cloudtrain/kql/datasets
COPY --from=data /opt/cloudtrain/loggen /opt/cloudtrain/loggen
COPY licences/NOTICE /usr/share/doc/cloudtrain-kql/NOTICE
COPY --chmod=0755 bin/kql bin/ct-kql bin/kql-load /usr/local/bin/
COPY bashrc /etc/cloudtrain/bashrc
COPY vimrc /etc/vim/vimrc.local
# Non-root learner (uid/gid 1000, what the runtime's securityContext uses); the ubuntu base
# user also has uid 1000, so it goes.
RUN userdel -r ubuntu 2>/dev/null; useradd -m -u 1000 -U -s /bin/bash learner \
 && echo '[ -f /etc/cloudtrain/bashrc ] && . /etc/cloudtrain/bashrc' | tee -a /etc/skel/.bashrc /root/.bashrc >> /home/learner/.bashrc \
 && ln -s /opt/cloudtrain/loggen/ct-loggen /usr/local/bin/ct-loggen \
 && ln -s /opt/cloudtrain/kql/lokql/lokql /usr/local/bin/lokql \
 && chmod -R a+rX /opt/cloudtrain /usr/share/doc/cloudtrain-kql \
 && install -d -m 0755 /srv/kql && install -d -m 0700 /var/lib/cloudtrain/kql \
 && printf 'CLOUDTRAIN_IMAGE=kql-ws\nKUSTOLOCO_VERSION=%s\nKUSTOLOCO_COMMIT=%s\nKUSTO_LANGUAGE_COMMIT=%s\nAZURE_SENTINEL_COMMIT=%s\n' \
      "$KUSTOLOCO_VERSION" "$KUSTOLOCO_COMMIT" "$KUSTO_LANGUAGE_COMMIT" "$AZURE_SENTINEL_COMMIT" > /etc/cloudtrain-release
# smoke test: the demo dataset loads with its types and a grader query answers correctly
RUN out=$(KQL_DATA=/opt/cloudtrain/kql/datasets/demo ct-kql scalar 'SigninLogs | where ResultType == "500121" | summarize dcount(UserPrincipalName)') \
 && test "$out" = 1 \
 && test "$(KQL_DATA=/opt/cloudtrain/kql/datasets/sentinel-sample ct-kql count 'Syslog | take 3')" = 3
# A lab workstation that only sleeps: Kubernetes ignores image health checks, the pod is
# ready when it runs.
HEALTHCHECK NONE
# uid of learner (created above)
USER 1000
WORKDIR /home/learner
CMD ["sleep", "infinity"]
