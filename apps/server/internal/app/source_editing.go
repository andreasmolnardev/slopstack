package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

type sourceIDInput struct {
	ID string `path:"id"`
}

type sourceUpdateInput struct {
	ID   string `path:"id"`
	Body struct {
		Title      *string `json:"title,omitempty"`
		Content    *string `json:"content,omitempty"`
		SourceType *string `json:"source_type,omitempty"`
	} `json:"body"`
}

type sourceOutput struct{ Body map[string]any }

func registerSourceEditingAPI(api huma.API) {
	huma.Register(api, huma.Operation{
		OperationID: "getLearningSource", Method: http.MethodGet, Path: "/api/learning/sources/{id}",
		Tags: []string{"Learning"}, Summary: "Get an owned source including its text",
		Security: []map[string][]string{{"pocketbaseAuth": {}}}, Errors: []int{http.StatusUnauthorized, http.StatusNotFound},
	}, func(context.Context, *sourceIDInput) (*sourceOutput, error) { return nil, nil })
	huma.Register(api, huma.Operation{
		OperationID: "updateLearningSource", Method: http.MethodPatch, Path: "/api/learning/sources/{id}",
		Tags: []string{"Learning"}, Summary: "Update an owned text or Markdown source",
		Security: []map[string][]string{{"pocketbaseAuth": {}}}, Errors: []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusNotFound},
	}, func(context.Context, *sourceUpdateInput) (*sourceOutput, error) { return nil, nil })
}

func registerSourceEditingRoutes(e *core.ServeEvent) {
	e.Router.GET("/api/learning/sources/{id}", getLearningSourceRoute)
	e.Router.PATCH("/api/learning/sources/{id}", updateLearningSourceRoute)
}

func getLearningSourceRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	sources, err := event.App.FindRecordsByFilter("learning_sources", "id = {:id} && owner = {:owner}", "", 1, 0, dbx.Params{"id": event.Request.PathValue("id"), "owner": user.Id})
	if err != nil {
		return event.InternalServerError("could not load source", err)
	}
	if len(sources) == 0 {
		return event.NotFoundError("source not found", nil)
	}
	return event.JSON(http.StatusOK, sources[0].PublicExport())
}

func updateLearningSourceRoute(event *core.RequestEvent) error {
	user, err := CurrentUser(event)
	if err != nil {
		return err
	}
	sources, err := event.App.FindRecordsByFilter("learning_sources", "id = {:id} && owner = {:owner}", "", 1, 0, dbx.Params{"id": event.Request.PathValue("id"), "owner": user.Id})
	if err != nil {
		return event.InternalServerError("could not load source", err)
	}
	if len(sources) == 0 {
		return event.NotFoundError("source not found", nil)
	}
	var patch struct {
		Title      *string `json:"title,omitempty"`
		Content    *string `json:"content,omitempty"`
		SourceType *string `json:"source_type,omitempty"`
	}
	decoder := json.NewDecoder(io.LimitReader(event.Request.Body, maxLearningBody+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&patch); err != nil {
		return event.BadRequestError("invalid source update", err)
	}
	source := sources[0]
	if patch.Title != nil {
		title := strings.TrimSpace(*patch.Title)
		if title == "" || len([]rune(title)) > 200 {
			return event.BadRequestError("source title must be between 1 and 200 characters", nil)
		}
		source.Set("title", title)
	}
	if patch.Content != nil {
		content := strings.TrimSpace(*patch.Content)
		if content == "" || len(content) > maxLearningBody {
			return event.BadRequestError("source text must be between 1 byte and 1 MiB", nil)
		}
		source.Set("content", content)
		metadata := map[string]any{}
		_ = source.UnmarshalJSONField("metadata", &metadata)
		metadata["bytes"] = len(content)
		source.Set("metadata", metadata)
	}
	if patch.SourceType != nil {
		sourceType := strings.TrimSpace(*patch.SourceType)
		if sourceType != "text/plain" && sourceType != "text/markdown" {
			return event.BadRequestError("only text/plain and text/markdown sources are supported", nil)
		}
		source.Set("source_type", sourceType)
	}
	if err := event.App.Save(source); err != nil {
		return event.BadRequestError("could not update source", err)
	}
	return event.JSON(http.StatusOK, source.PublicExport())
}
