// Command site-proxy is the sidecar of the public website's VM (docs/deploy-site-vm.md): between
// Caddy and the public Function app it rate-limits, authenticates to the function with the VM's
// managed identity and bounds what goes through. It holds no personal data and writes none down.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/cloudtrain/cloudtrain/services/site-proxy/internal/imds"
	"github.com/cloudtrain/cloudtrain/services/site-proxy/internal/limiter"
	"github.com/cloudtrain/cloudtrain/services/site-proxy/internal/proxy"
)

type config struct {
	listen          string
	functionURL     string
	auth            string
	audience        string
	clientID        string
	imdsURL         string
	clientIPHeader  string
	perIPPerHour    int
	globalRPS       float64
	globalBurst     int
	maxTrackedIPs   int
	maxBodyBytes    int64
	maxInFlight     int
	upstreamTimeout time.Duration
}

func loadConfig(get func(string) string) (config, error) {
	var errs []error
	str := func(name, def string) string {
		if v := strings.TrimSpace(get(name)); v != "" {
			return v
		}
		return def
	}
	positive := func(name string, def int) int {
		raw := str(name, "")
		if raw == "" {
			return def
		}
		n, err := strconv.Atoi(raw)
		if err != nil || n <= 0 {
			errs = append(errs, fmt.Errorf("%s must be a positive whole number", name))
			return def
		}
		return n
	}
	c := config{
		listen:         str("SITE_PROXY_LISTEN", ":8080"),
		functionURL:    str("SITE_PROXY_FUNCTION_URL", ""),
		auth:           str("SITE_PROXY_AUTH", "imds"),
		audience:       str("SITE_PROXY_FUNCTION_AUDIENCE", ""),
		clientID:       str("SITE_PROXY_CLIENT_ID", ""),
		imdsURL:        str("SITE_PROXY_IMDS_URL", imds.DefaultEndpoint),
		clientIPHeader: str("SITE_PROXY_CLIENT_IP_HEADER", "CF-Connecting-IP"),
		perIPPerHour:   positive("SITE_PROXY_PER_IP_PER_HOUR", 60),
		globalBurst:    positive("SITE_PROXY_GLOBAL_BURST", 5),
		maxTrackedIPs:  positive("SITE_PROXY_MAX_TRACKED_IPS", 50_000),
		maxBodyBytes:   int64(positive("SITE_PROXY_MAX_BODY_BYTES", 8<<10)),
		maxInFlight:    positive("SITE_PROXY_MAX_IN_FLIGHT", 16),
	}
	c.upstreamTimeout = time.Duration(positive("SITE_PROXY_UPSTREAM_TIMEOUT_SECONDS", 10)) * time.Second
	c.globalRPS = 5
	if raw := str("SITE_PROXY_GLOBAL_RPS", ""); raw != "" {
		v, err := strconv.ParseFloat(raw, 64)
		if err != nil || v <= 0 {
			errs = append(errs, errors.New("SITE_PROXY_GLOBAL_RPS must be a positive number"))
		} else {
			c.globalRPS = v
		}
	}
	// "socket" uses the connection's address. It is for local development: behind Caddy it would
	// put every visitor in one budget.
	if strings.EqualFold(c.clientIPHeader, "socket") {
		c.clientIPHeader = ""
	}
	u, err := url.Parse(c.functionURL)
	switch {
	case c.functionURL == "":
		errs = append(errs, errors.New("SITE_PROXY_FUNCTION_URL is required"))
	case err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" || (u.Path != "" && u.Path != "/") || u.RawQuery != "":
		errs = append(errs, errors.New("SITE_PROXY_FUNCTION_URL must be an origin such as https://name.azurewebsites.net"))
	}
	switch c.auth {
	case "imds":
		if c.audience == "" || c.clientID == "" {
			errs = append(errs, errors.New("SITE_PROXY_FUNCTION_AUDIENCE and SITE_PROXY_CLIENT_ID are required with SITE_PROXY_AUTH=imds"))
		}
		if err == nil && u != nil && u.Scheme != "https" && c.imdsURL == imds.DefaultEndpoint {
			errs = append(errs, errors.New("a real token goes over https only: SITE_PROXY_FUNCTION_URL must be https"))
		}
	case "none":
		// Local development only: nothing authenticates the call.
	default:
		errs = append(errs, errors.New("SITE_PROXY_AUTH must be imds or none"))
	}
	return c, errors.Join(errs...)
}

func main() {
	healthcheck := flag.Bool("healthcheck", false, "ask the running proxy for its health and exit (the distroless image has no curl)")
	flag.Parse()
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := loadConfig(os.Getenv)
	if *healthcheck {
		os.Exit(runHealthcheck(cfg.listen))
	}
	if err != nil {
		logger.Error("configuration", "err", err.Error())
		os.Exit(2)
	}

	var tokens proxy.TokenSource
	if cfg.auth == "imds" {
		c, err := imds.New(imds.Config{Endpoint: cfg.imdsURL, Resource: cfg.audience, ClientID: cfg.clientID})
		if err != nil {
			logger.Error("configuration", "err", err.Error())
			os.Exit(2)
		}
		tokens = c
	} else {
		logger.Warn("SITE_PROXY_AUTH=none: calling the function without a token, local development only")
	}

	lim := limiter.New(limiter.Config{
		PerKey:      cfg.perIPPerHour,
		Window:      time.Hour,
		GlobalRate:  cfg.globalRPS,
		GlobalBurst: cfg.globalBurst,
		MaxKeys:     cfg.maxTrackedIPs,
	}, nil)

	srv := &http.Server{
		Addr: cfg.listen,
		Handler: proxy.New(proxy.Options{
			FunctionURL:     cfg.functionURL,
			ClientIPHeader:  cfg.clientIPHeader,
			MaxBodyBytes:    cfg.maxBodyBytes,
			MaxInFlight:     cfg.maxInFlight,
			UpstreamTimeout: cfg.upstreamTimeout,
			Limiter:         lim,
			Tokens:          tokens,
			Logger:          logger,
		}),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      cfg.upstreamTimeout + 10*time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	logger.Info("listening", "addr", cfg.listen, "auth", cfg.auth, "perIPPerHour", cfg.perIPPerHour, "globalRPS", cfg.globalRPS)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server", "err", err.Error())
		os.Exit(1)
	}
}

func runHealthcheck(listen string) int {
	addr := listen
	if strings.HasPrefix(addr, ":") {
		addr = "127.0.0.1" + addr
	}
	c := http.Client{Timeout: 2 * time.Second}
	res, err := c.Get("http://" + addr + "/healthz")
	if err != nil {
		return 1
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusNoContent {
		return 1
	}
	return 0
}
