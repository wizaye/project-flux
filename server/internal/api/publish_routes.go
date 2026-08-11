package api

import (
	"net/http"

	"github.com/flux-pkm/server/internal/publish"
	"github.com/gin-gonic/gin"
)

func registerPublishRoutes(v1 *gin.RouterGroup, handler *Handler) {
	v1.GET("/publishing/connectors", handler.publicationConnectors)
	v1.POST("/publishing/connectors/:provider/setup", handler.setupPublicationConnector)
	v1.GET("/vaults/:vaultId/publications", handler.listPublications)
	v1.POST("/vaults/:vaultId/publications", handler.createPublication)
	v1.PUT("/vaults/:vaultId/publications/:publicationId", handler.updatePublication)
	v1.DELETE("/vaults/:vaultId/publications/:publicationId", handler.deletePublication)
	v1.POST("/vaults/:vaultId/publications/:publicationId/preview", handler.previewPublication)
	v1.POST("/vaults/:vaultId/publications/:publicationId/publish", handler.publishPublication)
	v1.GET("/vaults/:vaultId/publications/:publicationId/jobs", handler.listPublicationJobs)
	v1.GET("/vaults/:vaultId/publications/:publicationId/jobs/:jobId", handler.publicationJob)
	v1.GET("/vaults/:vaultId/publications/:publicationId/previews/:snapshotId", handler.publicationPreview)
	v1.POST("/vaults/:vaultId/publications/:publicationId/unpublish", handler.unpublishPublication)
}

func (h *Handler) publicationConnectors(c *gin.Context) {
	c.JSON(http.StatusOK, publish.Connectors())
}

func (h *Handler) setupPublicationConnector(c *gin.Context) {
	connector, err := publish.SetupConnector(c.Request.Context(), c.Param("provider"))
	if err != nil {
		writeRequestError(c, err)
		return
	}
	c.JSON(http.StatusOK, connector)
}

func (h *Handler) updatePublication(c *gin.Context) {
	var request publish.UpdatePublicationRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	updated, err := h.app.UpdatePublication(c.Param("vaultId"), c.Param("publicationId"), request)
	if err != nil {
		writeRequestError(c, err)
		return
	}
	c.JSON(http.StatusOK, updated)
}

func (h *Handler) listPublications(c *gin.Context) {
	items, err := h.app.ListPublications(c.Param("vaultId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, items)
}

func (h *Handler) createPublication(c *gin.Context) {
	var request publish.CreatePublicationRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writeRequestError(c, err)
		return
	}
	created, err := h.app.CreatePublication(c.Param("vaultId"), request)
	if err != nil {
		writeRequestError(c, err)
		return
	}
	c.JSON(http.StatusCreated, created)
}

func (h *Handler) deletePublication(c *gin.Context) {
	if err := h.app.DeletePublication(c.Param("vaultId"), c.Param("publicationId")); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) previewPublication(c *gin.Context) {
	h.buildPublication(c, false)
}

func (h *Handler) publishPublication(c *gin.Context) {
	h.buildPublication(c, true)
}

func (h *Handler) buildPublication(c *gin.Context, production bool) {
	job, err := h.app.StartPublicationJob(c.Param("vaultId"), c.Param("publicationId"), production)
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, job)
}

func (h *Handler) listPublicationJobs(c *gin.Context) {
	jobs, err := h.app.ListPublicationJobs(c.Param("vaultId"), c.Param("publicationId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, jobs)
}

func (h *Handler) publicationJob(c *gin.Context) {
	job, err := h.app.PublicationJob(c.Param("vaultId"), c.Param("publicationId"), c.Param("jobId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, job)
}

func (h *Handler) publicationPreview(c *gin.Context) {
	content, err := h.app.PublicationPreview(c.Param("vaultId"), c.Param("publicationId"), c.Param("snapshotId"))
	if err != nil {
		writeError(c, err)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", content)
}

func (h *Handler) unpublishPublication(c *gin.Context) {
	if err := h.app.UnpublishPublication(c.Request.Context(), c.Param("vaultId"), c.Param("publicationId")); err != nil {
		writeError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}
