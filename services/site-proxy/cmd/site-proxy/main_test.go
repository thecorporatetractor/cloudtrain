package main

import (
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

var valid = map[string]string{
	"SITE_PROXY_FUNCTION_URL":      "https://site-api.azurewebsites.net",
	"SITE_PROXY_FUNCTION_AUDIENCE": "api://site-api",
	"SITE_PROXY_CLIENT_ID":         "11111111-2222-3333-4444-555555555555",
}

func TestDefaultsAreTheOwnersNumbers(t *testing.T) {
	c, err := loadConfig(env(valid))
	if err != nil {
		t.Fatal(err)
	}
	if c.perIPPerHour != 60 || c.globalRPS != 5 || c.clientIPHeader != "CF-Connecting-IP" || c.auth != "imds" {
		t.Fatalf("%+v", c)
	}
}

func TestSocketMode(t *testing.T) {
	m := map[string]string{"SITE_PROXY_FUNCTION_URL": "http://localhost:1", "SITE_PROXY_AUTH": "none", "SITE_PROXY_CLIENT_IP_HEADER": "socket"}
	c, err := loadConfig(env(m))
	if err != nil || c.clientIPHeader != "" {
		t.Fatalf("%+v %v", c, err)
	}
}

func TestRefusals(t *testing.T) {
	with := func(k, v string) map[string]string {
		m := map[string]string{}
		for a, b := range valid {
			m[a] = b
		}
		m[k] = v
		return m
	}
	for name, m := range map[string]map[string]string{
		"no function":      with("SITE_PROXY_FUNCTION_URL", ""),
		"function path":    with("SITE_PROXY_FUNCTION_URL", "https://x.net/api"),
		"plain http token": with("SITE_PROXY_FUNCTION_URL", "http://x.net"),
		"no audience":      with("SITE_PROXY_FUNCTION_AUDIENCE", ""),
		"no client id":     with("SITE_PROXY_CLIENT_ID", ""),
		"unknown auth":     with("SITE_PROXY_AUTH", "basic"),
		"bad limit":        with("SITE_PROXY_PER_IP_PER_HOUR", "0"),
		"bad rate":         with("SITE_PROXY_GLOBAL_RPS", "-1"),
	} {
		if _, err := loadConfig(env(m)); err == nil {
			t.Errorf("%s: accepted", name)
		} else if strings.Contains(err.Error(), "11111111") {
			t.Errorf("%s: the message repeats a value", name)
		}
	}
}
