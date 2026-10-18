#!/usr/bin/env python3
"""Lab helper for the simulated vCenter (ct-vcsim), over the vSphere SOAP API.
  vcsim.py init          rename the default DC0 / DC0_C0 to dc-saltmarsh / farm-compute (idempotent)
  vcsim.py moid PATH     managed object id at an inventory path, or "none"
  vcsim.py shares PATH   cpu share level:shares of the resource pool at PATH, or none."""
import http.cookiejar, re, ssl, sys, time, urllib.request

URL = "https://127.0.0.1:8989/sdk"
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPSHandler(context=ctx), urllib.request.HTTPCookieProcessor(jar))

def call(body):
    env = ('<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" '
           'xmlns:urn="urn:vim25"><soapenv:Body>%s</soapenv:Body></soapenv:Envelope>' % body)
    req = urllib.request.Request(URL, env.encode(), {"Content-Type": "text/xml", "SOAPAction": "urn:vim25/8.0"})
    return op.open(req, timeout=20).read().decode()

def find(path):
    r = call('<urn:FindByInventoryPath><urn:_this type="SearchIndex">SearchIndex</urn:_this>'
             '<urn:inventoryPath>%s</urn:inventoryPath></urn:FindByInventoryPath>' % path)
    m = re.search(r'<returnval type="(\w+)">([^<]+)</returnval>', r)
    return m.groups() if m else None

def rename(obj, name):
    t, moid = obj
    call('<urn:Rename_Task><urn:_this type="%s">%s</urn:_this><urn:newName>%s</urn:newName></urn:Rename_Task>' % (t, moid, name))

def login():
    call('<urn:Login><urn:_this type="SessionManager">SessionManager</urn:_this>'
         '<urn:userName>saltmarsh</urn:userName><urn:password>saltmarsh-lab</urn:password></urn:Login>')

def init():
    if find("dc-saltmarsh"):
        return
    cl = find("DC0/host/DC0_C0"); dc = find("DC0")
    if not cl or not dc:
        sys.exit("vcsim: default inventory DC0/DC0_C0 not found")
    rename(cl, "farm-compute"); rename(dc, "dc-saltmarsh")
    for _ in range(20):
        if find("dc-saltmarsh/host/farm-compute"):
            return
        time.sleep(0.5)
    sys.exit("vcsim: rename did not complete")

def shares(path):
    o = find(path)
    if not o:
        return "none"
    r = call('<urn:RetrievePropertiesEx><urn:_this type="PropertyCollector">propertyCollector</urn:_this>'
             '<urn:specSet><urn:propSet><urn:type>%s</urn:type><urn:pathSet>config</urn:pathSet></urn:propSet>'
             '<urn:objectSet><urn:obj type="%s">%s</urn:obj></urn:objectSet></urn:specSet><urn:options/>'
             '</urn:RetrievePropertiesEx>' % (o[0], o[0], o[1]))
    m = re.search(r'<cpuAllocation>.*?<shares><shares>(\d+)</shares><level>(\w+)</level>', r, re.S)
    return "%s:%s" % (m.group(2), m.group(1)) if m else "unknown"

login()
cmd = sys.argv[1] if len(sys.argv) > 1 else ""
if cmd == "init":
    init()
elif cmd == "moid":
    o = find(sys.argv[2]); print(o[1] if o else "none")
elif cmd == "shares":
    print(shares(sys.argv[2]))
else:
    sys.exit(__doc__)
